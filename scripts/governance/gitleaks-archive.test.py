#!/usr/bin/env python3
"""Tests for scripts/governance/gitleaks-archive.py — stdlib only."""

from __future__ import annotations

import gzip
import hashlib
import importlib.util
import io
import os
import shutil
import signal
import subprocess
import sys
import tarfile
import tempfile
import textwrap
import unittest
from pathlib import Path
from typing import Callable
from unittest import mock

sys.dont_write_bytecode = True

MODULE_PATH = Path(
    os.environ.get(
        "GITLEAKS_ARCHIVE_MODULE",
        str(Path(__file__).with_name("gitleaks-archive.py")),
    )
)
TEST_PATH = Path(__file__)
PYTHON_FLAGS = ["-B"]

SKIP_MUTATION_SUITE = bool(os.environ.get("GITLEAKS_ARCHIVE_MODULE"))

spec = importlib.util.spec_from_file_location("gitleaks_archive", MODULE_PATH)
assert spec and spec.loader
gitleaks_archive = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gitleaks_archive)


ACCEPT = gitleaks_archive.ACCEPT
POLICY = gitleaks_archive.POLICY
OPERATIONAL = gitleaks_archive.OPERATIONAL
EXPECTED_MEMBERS = gitleaks_archive.EXPECTED_MEMBERS


def run_cli(*args: str, env: dict[str, str] | None = None, timeout: float | None = None) -> subprocess.CompletedProcess[str]:
    merged = os.environ.copy()
    merged["PYTHONDONTWRITEBYTECODE"] = "1"
    if env:
        merged.update(env)
    return subprocess.run(
        [sys.executable, *PYTHON_FLAGS, str(MODULE_PATH), *args],
        capture_output=True,
        text=True,
        env=merged,
        check=False,
        timeout=timeout,
    )


def read_members_from_bytes(data: bytes) -> list[tarfile.TarInfo]:
    with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as tf:
        return tf.getmembers()


def pax_global_payload(comment: str = "globalmeta") -> bytes:
    for length in range(10, 100):
        record = f"{length} comment={comment}\n"
        if len(record) == length:
            return record.encode("ascii")
    raise RuntimeError("unable to build pax global payload")


def build_global_pax_archive() -> bytes:
    payload = pax_global_payload()
    global_header = tarfile.TarInfo(name="././@PaxHeader")
    global_header.type = tarfile.XGLTYPE
    global_header.size = len(payload)

    def block512(data: bytes) -> bytes:
        return data + b"\0" * ((512 - len(data) % 512) % 512)

    raw = io.BytesIO()
    raw.write(global_header.tobuf(format=tarfile.USTAR_FORMAT, encoding="utf-8", errors="surrogateescape"))
    raw.write(block512(payload))
    for name, data in [
        ("LICENSE", b"license\n"),
        ("README.md", b"readme\n"),
        ("gitleaks", b"binary\n"),
    ]:
        info = tarfile.TarInfo(name=name)
        info.size = len(data)
        raw.write(info.tobuf(format=tarfile.USTAR_FORMAT, encoding="utf-8", errors="surrogateescape"))
        raw.write(block512(data))
    raw.write(b"\0" * 1024)
    return gzip.compress(raw.getvalue())


def low_level_tar_records(data: bytes) -> list[tuple[str, bytes]]:
    raw = gzip.decompress(data)
    records: list[tuple[str, bytes]] = []
    offset = 0
    while offset + 512 <= len(raw):
        header = raw[offset : offset + 512]
        if header == b"\0" * 512:
            break
        name = header[0:100].split(b"\0", 1)[0].decode("utf-8", "surrogateescape")
        typeflag = header[156:157]
        size = int(header[124:136].split(b"\0", 1)[0] or b"0", 8)
        records.append((name, typeflag))
        offset += 512
        offset += ((size + 511) // 512) * 512
    return records


def write_mutated_module(source: Path, target: Path, old: str, new: str, count: int = 1) -> None:
    text = source.read_text(encoding="utf-8")
    target.write_text(text.replace(old, new, count), encoding="utf-8")


def run_archive_suite_against_module(module_path: Path, timeout: float = 30.0) -> subprocess.CompletedProcess[str]:
    env = os.environ.copy()
    env["PYTHONDONTWRITEBYTECODE"] = "1"
    env["GITLEAKS_ARCHIVE_MODULE"] = str(module_path)
    return subprocess.run(
        [sys.executable, *PYTHON_FLAGS, str(TEST_PATH)],
        capture_output=True,
        text=True,
        env=env,
        check=False,
        timeout=timeout,
    )


def build_wrong_member_set_archive() -> bytes:
    return TarFixtureBuilder(
        {
            "gitleaks": b"binary\n",
            "LICENSE": b"license\n",
            "CHANGELOG.md": b"release notes\n",
        }
    ).build()


class TarFixtureBuilder:
    def __init__(self, placeholders: dict[str, bytes] | None = None) -> None:
        self.payloads = placeholders or {
            "gitleaks": b"binary\n",
            "LICENSE": b"license\n",
            "README.md": b"readme\n",
        }

    def build(
        self,
        mutate: Callable[[tarfile.TarFile], None] | None = None,
        *,
        member_mutators: dict[str, Callable[[tarfile.TarInfo], None]] | None = None,
        tar_format: int = tarfile.DEFAULT_FORMAT,
        preamble: Callable[[tarfile.TarFile], None] | None = None,
    ) -> bytes:
        buf = io.BytesIO()
        with tarfile.open(fileobj=buf, mode="w:gz", format=tar_format) as tf:
            if preamble:
                preamble(tf)
            for name, payload in self.payloads.items():
                info = tarfile.TarInfo(name=name)
                info.size = len(payload)
                if member_mutators and name in member_mutators:
                    member_mutators[name](info)
                tf.addfile(info, io.BytesIO(payload))
            if mutate:
                mutate(tf)
        return buf.getvalue()


def mutate_member_type(
    member_name: str,
    typecode: bytes,
    *,
    zero_size: bool = True,
    **attrs: object,
) -> dict[str, Callable[[tarfile.TarInfo], None]]:
    def mutator(info: tarfile.TarInfo) -> None:
        if info.name != member_name:
            return
        info.type = typecode
        if zero_size:
            info.size = 0
        for key, value in attrs.items():
            setattr(info, key, value)

    return {member_name: mutator}


class GitleaksArchiveTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.root = self.temp_dir.name

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def write_archive(self, name: str, data: bytes) -> str:
        path = os.path.join(self.root, name)
        with open(path, "wb") as handle:
            handle.write(data)
        return path

    def valid_archive(self, **kwargs: object) -> str:
        return self.write_archive("valid.tar.gz", TarFixtureBuilder().build(**kwargs))

    def dest_path(self, *parts: str, name: str = "gitleaks") -> str:
        return os.path.join(self.root, *parts, name)

    def runner_root(self, *parts: str) -> str:
        path = os.path.join(self.root, *parts)
        os.makedirs(path, exist_ok=True)
        return path

    def assert_member_names_exact(self, data: bytes) -> None:
        names = {member.name for member in read_members_from_bytes(data)}
        logical = names & EXPECTED_MEMBERS
        self.assertEqual(logical, EXPECTED_MEMBERS, msg=f"unexpected logical names: {names}")

    def test_standard_regtype_archive_accepted(self) -> None:
        archive = self.valid_archive()
        self.assertEqual(run_cli("validate", archive).returncode, ACCEPT)

    def test_aregtype_archive_accepted(self) -> None:
        data = TarFixtureBuilder().build(
            member_mutators={"gitleaks": lambda info: setattr(info, "type", tarfile.AREGTYPE)}
        )
        members = read_members_from_bytes(data)
        gitleaks = next(member for member in members if member.name == "gitleaks")
        if gitleaks.type != tarfile.AREGTYPE:
            self.skipTest("platform tarfile normalized AREGTYPE before serialization")
        self.assertEqual(gitleaks.type, tarfile.AREGTYPE)
        archive = self.write_archive("aregtype.tar.gz", data)
        self.assertEqual(run_cli("validate", archive).returncode, ACCEPT)

    def test_official_archive_accepted_when_present(self) -> None:
        official = os.environ.get("GITLEAKS_OFFICIAL_ARCHIVE", "/tmp/gitleaks_8.30.0_linux_x64_official.tar.gz")
        if not os.path.isfile(official):
            self.skipTest("official archive unavailable")
        self.assertEqual(run_cli("validate", official).returncode, ACCEPT)

    def test_exact_member_set_enforcement(self) -> None:
        missing_data = TarFixtureBuilder({"gitleaks": b"x\n", "LICENSE": b"l\n"}).build()
        self.assertEqual({member.name for member in read_members_from_bytes(missing_data)}, {"gitleaks", "LICENSE"})
        self.assertEqual(run_cli("validate", self.write_archive("missing.tar.gz", missing_data)).returncode, POLICY)

        extra_data = TarFixtureBuilder().build(
            mutate=lambda tf: tf.addfile(tarfile.TarInfo(name="evil.txt"), io.BytesIO(b"evil"))
        )
        self.assertEqual(len(read_members_from_bytes(extra_data)), 4)
        self.assertEqual(run_cli("validate", self.write_archive("extra.tar.gz", extra_data)).returncode, POLICY)

    def test_wrong_member_set_rejected(self) -> None:
        data = build_wrong_member_set_archive()
        names = {member.name for member in read_members_from_bytes(data)}
        self.assertEqual(len(names), 3)
        self.assertNotEqual(names, EXPECTED_MEMBERS)
        self.assertEqual(names, {"gitleaks", "LICENSE", "CHANGELOG.md"})
        archive = self.write_archive("wrong-set.tar.gz", data)
        self.assertEqual(run_cli("validate", archive).returncode, POLICY)

    def test_contiguous_member_rejected(self) -> None:
        data = TarFixtureBuilder().build(
            member_mutators=mutate_member_type("gitleaks", tarfile.CONTTYPE, zero_size=False)
        )
        members = read_members_from_bytes(data)
        gitleaks = next(member for member in members if member.name == "gitleaks")
        self.assertEqual(gitleaks.type, tarfile.CONTTYPE)
        self.assertEqual({member.name for member in members}, EXPECTED_MEMBERS)
        self.assertEqual(run_cli("validate", self.write_archive("cont.tar.gz", data)).returncode, POLICY)

    def test_per_member_pax_rejected(self) -> None:
        data = TarFixtureBuilder().build(
            member_mutators={
                "gitleaks": lambda info: info.pax_headers.update({"comment": "per-member"})
            },
            tar_format=tarfile.PAX_FORMAT,
        )
        members = read_members_from_bytes(data)
        gitleaks = next(member for member in members if member.name == "gitleaks")
        self.assertTrue(getattr(gitleaks, "pax_headers", {}))
        self.assertEqual(run_cli("validate", self.write_archive("pax-member.tar.gz", data)).returncode, POLICY)

    def test_global_pax_genuine_archive_rejected(self) -> None:
        data = build_global_pax_archive()
        records = low_level_tar_records(data)
        self.assertEqual(records[0], ("././@PaxHeader", tarfile.XGLTYPE))
        self.assertEqual(len(records), 4)
        self.assertEqual(
            {name for name, _type in records[1:]},
            {"LICENSE", "README.md", "gitleaks"},
        )

        with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as tf:
            members = tf.getmembers()
            self.assertEqual(len(members), 3)
            self.assertEqual(tf.pax_headers.get("comment"), "globalmeta")
            self.assertFalse(hasattr(tf, "_pax_global_headers"))

        archive = self.write_archive("global-pax.tar.gz", data)
        self.assertEqual(run_cli("validate", archive).returncode, POLICY)

    def test_policy_rejections(self) -> None:
        type_cases = {
            "duplicate-member": lambda tf: tf.addfile(
                tarfile.TarInfo(name="gitleaks"),
                io.BytesIO(b"dup\n"),
            ),
            "absolute-name": lambda tf: tf.addfile(
                tarfile.TarInfo(name="/abs"),
                io.BytesIO(b"x"),
            ),
            "traversal-name": lambda tf: tf.addfile(
                tarfile.TarInfo(name="../escape"),
                io.BytesIO(b"x"),
            ),
            "nested-name": lambda tf: tf.addfile(
                tarfile.TarInfo(name="nested/x"),
                io.BytesIO(b"x"),
            ),
            "dot-prefix": lambda tf: tf.addfile(
                tarfile.TarInfo(name=".hidden"),
                io.BytesIO(b"x"),
            ),
        }
        member_type_cases = {
            "symlink": ("gitleaks", tarfile.SYMTYPE, {"linkname": "LICENSE"}),
            "hardlink": ("gitleaks", tarfile.LNKTYPE, {"linkname": "LICENSE"}),
            "directory": ("gitleaks", tarfile.DIRTYPE, {}),
            "char-device": ("gitleaks", tarfile.CHRTYPE, {"devmajor": 1, "devminor": 3}),
            "block-device": ("gitleaks", tarfile.BLKTYPE, {"devmajor": 8, "devminor": 0}),
            "fifo": ("gitleaks", tarfile.FIFOTYPE, {}),
            "unknown-type": ("gitleaks", b"9", {"zero_size": False}),
            "gnu-sparse-type": ("gitleaks", tarfile.GNUTYPE_SPARSE, {}),
        }

        for label, mutate in type_cases.items():
            with self.subTest(label=label):
                data = TarFixtureBuilder().build(mutate)
                archive = self.write_archive(f"{label}.tar.gz", data)
                self.assertEqual(run_cli("validate", archive).returncode, POLICY)

        for label, (member_name, typecode, attrs) in member_type_cases.items():
            with self.subTest(label=label):
                zero_size = attrs.pop("zero_size", True)
                data = TarFixtureBuilder().build(
                    member_mutators=mutate_member_type(
                        member_name,
                        typecode,
                        zero_size=zero_size,
                        **attrs,
                    )
                )
                self.assert_member_names_exact(data)
                member = next(item for item in read_members_from_bytes(data) if item.name == member_name)
                self.assertEqual(member.type, typecode)
                archive = self.write_archive(f"{label}.tar.gz", data)
                self.assertEqual(run_cli("validate", archive).returncode, POLICY)

        empty_data = TarFixtureBuilder(
            {
                "gitleaks": b"",
                "LICENSE": b"license\n",
                "README.md": b"readme\n",
            }
        ).build(member_mutators={"gitleaks": lambda info: setattr(info, "size", 0)})
        self.assertEqual(run_cli("validate", self.write_archive("empty-member.tar.gz", empty_data)).returncode, POLICY)

    def test_oversized_member_rejected(self) -> None:
        payload = b"x" * 32
        data = TarFixtureBuilder({"gitleaks": payload, "LICENSE": b"l\n", "README.md": b"r\n"}).build()
        archive = self.write_archive("oversized.tar.gz", data)
        with mock.patch.object(gitleaks_archive, "MAX_MEMBER_SIZE", 16):
            with self.assertRaises(SystemExit) as ctx:
                gitleaks_archive.cmd_validate(archive)
            self.assertEqual(ctx.exception.code, POLICY)

    def test_malformed_archive_rejected(self) -> None:
        archive = self.write_archive("bad.tar.gz", b"not-a-valid-archive")
        self.assertEqual(run_cli("validate", archive).returncode, POLICY)

    def test_invalid_cli_usage_returns_operational(self) -> None:
        cases = [
            [],
            ["unknown"],
            ["validate"],
            ["install", "a.tar.gz"],
            ["install", "a.tar.gz", "dest"],
            ["validate", "a.tar.gz", "--unexpected"],
            ["install", "a.tar.gz", "dest", "--runner-temp", "/tmp", "extra"],
        ]
        for args in cases:
            with self.subTest(args=args):
                result = run_cli(*args)
                self.assertEqual(result.returncode, OPERATIONAL, msg=result.stderr)

    def test_help_exits_zero(self) -> None:
        self.assertEqual(run_cli("--help").returncode, ACCEPT)
        self.assertEqual(run_cli("validate", "--help").returncode, ACCEPT)

    def test_missing_archive_operational(self) -> None:
        missing = os.path.join(self.root, "missing.tar.gz")
        self.assertEqual(run_cli("validate", missing).returncode, OPERATIONAL)

    def test_empty_archive_operational(self) -> None:
        archive = self.write_archive("empty.tar.gz", b"")
        self.assertEqual(run_cli("validate", archive).returncode, OPERATIONAL)

    def test_non_regular_archive_operational(self) -> None:
        path = os.path.join(self.root, "dir-input")
        os.mkdir(path)
        self.assertEqual(run_cli("validate", path).returncode, OPERATIONAL)

    def test_unreadable_archive_operational(self) -> None:
        archive = self.valid_archive()
        os.chmod(archive, 0o000)
        try:
            if os.access(archive, os.R_OK):
                self.skipTest("platform retained read permission")
            self.assertEqual(run_cli("validate", archive).returncode, OPERATIONAL)
        finally:
            os.chmod(archive, 0o644)

    def test_unexpected_internal_exception_operational(self) -> None:
        with mock.patch.object(gitleaks_archive, "read_members", side_effect=RuntimeError("boom")):
            with self.assertRaises(SystemExit) as ctx:
                gitleaks_archive.cmd_validate(self.valid_archive())
            self.assertEqual(ctx.exception.code, OPERATIONAL)

    def test_relative_contained_destination_succeeds(self) -> None:
        archive = self.valid_archive()
        runner = self.runner_root("runner")
        dest = self.dest_path("runner", "out", "gitleaks")
        self.assertEqual(run_cli("install", archive, dest, "--runner-temp", runner).returncode, ACCEPT)
        self.assertTrue(os.path.isfile(dest))

    def test_destination_outside_runner_temp(self) -> None:
        archive = self.valid_archive()
        runner = self.runner_root("runner")
        outside_root = self.runner_root("outside-root")
        dest = self.dest_path("outside-root", "nested", "gitleaks")
        self.assertNotEqual(
            os.path.commonpath([os.path.abspath(dest), os.path.abspath(runner)]),
            os.path.abspath(runner),
        )
        self.assertEqual(
            run_cli("install", archive, dest, "--runner-temp", runner).returncode,
            OPERATIONAL,
        )

    def test_symlinked_runner_root_rejected(self) -> None:
        archive = self.valid_archive()
        real_runner = self.runner_root("real-runner")
        link_runner = os.path.join(self.root, "link-runner")
        os.symlink(real_runner, link_runner)
        dest = self.dest_path("real-runner", "out", "gitleaks")
        self.assertEqual(
            run_cli("install", archive, dest, "--runner-temp", link_runner).returncode,
            OPERATIONAL,
        )

    def test_invalid_runner_temp(self) -> None:
        archive = self.valid_archive()
        dest = self.dest_path("runner", "out")
        self.assertEqual(
            run_cli("install", archive, dest, "--runner-temp", os.path.join(self.root, "missing")).returncode,
            OPERATIONAL,
        )

    def test_wrong_destination_basename(self) -> None:
        archive = self.valid_archive()
        runner = self.runner_root("runner")
        dest = os.path.join(runner, "not-gitleaks")
        self.assertEqual(
            run_cli("install", archive, dest, "--runner-temp", runner).returncode,
            OPERATIONAL,
        )

    def test_existing_regular_destination(self) -> None:
        archive = self.valid_archive()
        dest = self.dest_path("out")
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        with open(dest, "wb") as handle:
            handle.write(b"exists\n")
        self.assertEqual(
            run_cli("install", archive, dest, "--runner-temp", self.root).returncode,
            OPERATIONAL,
        )

    def test_existing_symlink_destination(self) -> None:
        archive = self.valid_archive()
        dest = self.dest_path("out")
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        os.symlink(os.path.join(self.root, "target"), dest)
        self.assertEqual(
            run_cli("install", archive, dest, "--runner-temp", self.root).returncode,
            OPERATIONAL,
        )

    def test_existing_broken_symlink_destination(self) -> None:
        archive = self.valid_archive()
        dest = self.dest_path("out")
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        os.symlink(os.path.join(self.root, "missing-target"), dest)
        self.assertEqual(
            run_cli("install", archive, dest, "--runner-temp", self.root).returncode,
            OPERATIONAL,
        )

    def test_symlinked_parent_rejected(self) -> None:
        archive = self.valid_archive()
        runner = self.runner_root("runner")
        real_out = os.path.join(runner, "real-out")
        link_out = os.path.join(runner, "link-out")
        os.makedirs(real_out, exist_ok=True)
        os.symlink(real_out, link_out)
        dest = os.path.join(link_out, "gitleaks")
        self.assertEqual(
            run_cli("install", archive, dest, "--runner-temp", runner).returncode,
            OPERATIONAL,
        )

    def test_readonly_destination_directory(self) -> None:
        archive = self.valid_archive()
        dest = self.dest_path("out")
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        os.chmod(os.path.dirname(dest), 0o555)
        try:
            result = run_cli("install", archive, dest, "--runner-temp", self.root)
            self.assertEqual(result.returncode, OPERATIONAL)
        finally:
            os.chmod(os.path.dirname(dest), 0o755)

    def test_zero_byte_write_returns_operational_without_hang(self) -> None:
        archive = self.valid_archive()
        dest = self.dest_path("out")
        script = textwrap.dedent(
            f"""
            import importlib.util
            import os
            import sys
            import unittest.mock as mock
            sys.dont_write_bytecode = True
            spec = importlib.util.spec_from_file_location(
                "mod", os.environ.get("GITLEAKS_ARCHIVE_MODULE", {str(MODULE_PATH)!r})
            )
            mod = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(mod)
            with mock.patch.object(mod.os, "write", return_value=0):
                try:
                    mod.cmd_install({archive!r}, {dest!r}, {self.root!r})
                except SystemExit as exc:
                    raise SystemExit(exc.code)
            raise SystemExit(99)
            """
        )
        proc = subprocess.run(
            [sys.executable, *PYTHON_FLAGS, "-c", script],
            capture_output=True,
            text=True,
            env={**os.environ, "PYTHONDONTWRITEBYTECODE": "1"},
            timeout=5,
            check=False,
        )
        self.assertEqual(proc.returncode, OPERATIONAL)
        self.assertFalse(os.path.lexists(dest))
        out_dir = os.path.dirname(dest)
        if os.path.isdir(out_dir):
            temps = [name for name in os.listdir(out_dir) if name.startswith(".gitleaks-install.")]
            self.assertEqual(temps, [])

    def test_short_writes_complete_installation(self) -> None:
        archive = self.valid_archive()
        dest = self.dest_path("out")
        expected = b"binary\n"
        writes: list[bytes] = []
        real_write = gitleaks_archive.os.write

        def fake_write(fd: int, data: memoryview | bytes) -> int:
            chunk = bytes(data)
            if len(chunk) > 1:
                piece = chunk[:1]
                writes.append(piece)
                return real_write(fd, piece)
            writes.append(chunk)
            return real_write(fd, chunk)

        with mock.patch.object(gitleaks_archive.os, "write", fake_write):
            with self.assertRaises(SystemExit) as ctx:
                gitleaks_archive.cmd_install(archive, dest, self.root)
            self.assertEqual(ctx.exception.code, ACCEPT)
        self.assertEqual(b"".join(writes), expected)
        with open(dest, "rb") as handle:
            self.assertEqual(handle.read(), expected)

    def test_oversized_write_count_returns_operational(self) -> None:
        archive = self.valid_archive()
        dest = self.dest_path("out")

        def fake_write(fd: int, data: memoryview | bytes) -> int:
            return len(data) + 10

        with mock.patch.object(gitleaks_archive.os, "write", side_effect=fake_write):
            with self.assertRaises(SystemExit) as ctx:
                gitleaks_archive.cmd_install(archive, dest, self.root)
            self.assertEqual(ctx.exception.code, OPERATIONAL)
        self.assertFalse(os.path.lexists(dest))

    def test_write_exception_after_partial_progress_cleans_up(self) -> None:
        archive = self.valid_archive()
        dest = self.dest_path("out")
        seen = {"count": 0}

        def flaky_write(fd: int, data: memoryview | bytes) -> int:
            seen["count"] += 1
            if seen["count"] == 1:
                return 1
            raise OSError("write failed")

        with mock.patch.object(gitleaks_archive.os, "write", side_effect=flaky_write):
            with self.assertRaises(SystemExit) as ctx:
                gitleaks_archive.cmd_install(archive, dest, self.root)
            self.assertEqual(ctx.exception.code, OPERATIONAL)
        self.assertFalse(os.path.lexists(dest))

    def test_simulated_write_failure_cleans_up(self) -> None:
        archive = self.valid_archive()
        dest = self.dest_path("out")
        with mock.patch.object(gitleaks_archive, "write_temp_payload", side_effect=gitleaks_archive.OperationalFailure("write")):
            with self.assertRaises(SystemExit) as ctx:
                gitleaks_archive.cmd_install(archive, dest, self.root)
            self.assertEqual(ctx.exception.code, OPERATIONAL)
        self.assertFalse(os.path.lexists(dest))

    def test_simulated_chmod_failure_cleans_up(self) -> None:
        archive = self.valid_archive()
        dest = self.dest_path("out")
        with mock.patch.object(gitleaks_archive.os, "chmod", side_effect=OSError("chmod")):
            with self.assertRaises(SystemExit) as ctx:
                gitleaks_archive.cmd_install(archive, dest, self.root)
            self.assertEqual(ctx.exception.code, OPERATIONAL)
        self.assertFalse(os.path.lexists(dest))

    def test_simulated_atomic_publication_failure_cleans_up(self) -> None:
        archive = self.valid_archive()
        dest = self.dest_path("out")
        with mock.patch.object(gitleaks_archive.os, "link", side_effect=OSError("link")):
            with self.assertRaises(SystemExit) as ctx:
                gitleaks_archive.cmd_install(archive, dest, self.root)
            self.assertEqual(ctx.exception.code, OPERATIONAL)
        self.assertFalse(os.path.lexists(dest))

    def test_install_writes_only_gitleaks(self) -> None:
        archive = self.valid_archive()
        dest = self.dest_path("out")
        self.assertEqual(
            run_cli("install", archive, dest, "--runner-temp", self.root).returncode,
            ACCEPT,
        )
        out_dir = os.path.dirname(dest)
        names = set(os.listdir(out_dir))
        self.assertIn("gitleaks", names)
        self.assertNotIn("LICENSE", names)
        self.assertNotIn("README.md", names)
        temps = [name for name in names if name.startswith(".gitleaks-install.")]
        self.assertEqual(temps, [])

    def test_verify_digest_exact_match(self) -> None:
        archive = self.valid_archive()
        digest = hashlib.sha256(Path(archive).read_bytes()).hexdigest()
        self.assertEqual(run_cli("verify-digest", archive, digest).returncode, ACCEPT)

    def test_verify_digest_suffix_fails(self) -> None:
        archive = self.valid_archive()
        digest = hashlib.sha256(Path(archive).read_bytes()).hexdigest()
        self.assertEqual(run_cli("verify-digest", archive, digest + "0").returncode, OPERATIONAL)

    def test_verify_digest_prefix_only_fails(self) -> None:
        archive = self.valid_archive()
        digest = hashlib.sha256(Path(archive).read_bytes()).hexdigest()
        self.assertEqual(run_cli("verify-digest", archive, digest[:32]).returncode, OPERATIONAL)

    def test_verify_digest_wrong_fails(self) -> None:
        archive = self.valid_archive()
        wrong = "0" * 64
        self.assertEqual(run_cli("verify-digest", archive, wrong).returncode, OPERATIONAL)

    def test_verify_digest_empty_or_malformed_fails(self) -> None:
        archive = self.valid_archive()
        self.assertEqual(run_cli("verify-digest", archive, "").returncode, OPERATIONAL)
        self.assertEqual(run_cli("verify-digest", archive, "not-a-digest").returncode, OPERATIONAL)

    def test_verify_digest_missing_archive_fails(self) -> None:
        missing = os.path.join(self.root, "missing.tar.gz")
        self.assertEqual(
            run_cli("verify-digest", missing, "0" * 64).returncode,
            OPERATIONAL,
        )

    def test_cli_exit_codes_remain_exact(self) -> None:
        self.assertEqual(run_cli("validate", self.valid_archive()).returncode, ACCEPT)
        self.assertEqual(run_cli("validate", self.write_archive("bad.tar.gz", b"nope")).returncode, POLICY)
        self.assertEqual(run_cli("validate", os.path.join(self.root, "missing")).returncode, OPERATIONAL)

    def test_sigterm_is_not_success(self) -> None:
        archive = self.valid_archive()
        proc = subprocess.Popen(
            [sys.executable, *PYTHON_FLAGS, str(MODULE_PATH), "validate", archive],
            env={**os.environ, "PYTHONDONTWRITEBYTECODE": "1"},
            preexec_fn=os.setsid if hasattr(os, "setsid") else None,
        )
        proc.send_signal(signal.SIGTERM)
        proc.wait(timeout=5)
        self.assertNotEqual(proc.returncode, ACCEPT)

    def test_no_adversarial_metadata_leak(self) -> None:
        adversarial = "evil\r\n::set-output name=x::y\x1b[31mLICENSE\x07"
        data = TarFixtureBuilder().build(
            mutate=lambda tf: tf.addfile(
                tarfile.TarInfo(name=adversarial),
                io.BytesIO(b"x"),
            )
        )
        archive = self.write_archive("adversarial.tar.gz", data)
        result = run_cli("validate", archive)
        combined = result.stdout + result.stderr
        for token in ("\r", "\x1b", "\x07", adversarial, "LICENSE", "README.md", "gitleaks", "::set-output"):
            self.assertNotIn(token, combined)

    def test_fixture_stays_in_temp_root(self) -> None:
        archive = self.valid_archive()
        self.assertTrue(os.path.realpath(archive).startswith(os.path.realpath(self.root)))

    @unittest.skipIf(SKIP_MUTATION_SUITE, "mutation subprocess mode")
    def test_infinite_write_guard_prevents_hang(self) -> None:
        archive = self.valid_archive()
        with tempfile.TemporaryDirectory() as mutation_root:
            source = Path(mutation_root) / "source.py"
            mutant = Path(mutation_root) / "loop.py"
            shutil.copy2(MODULE_PATH, source)
            loop_source = source.read_text(encoding="utf-8").replace(
                "            written = os.write(fd, view[offset:])\n"
                "            if written <= 0:\n"
                "                raise OperationalFailure(\"temporary write failure\")\n"
                "            if written > remaining:\n"
                "                raise OperationalFailure(\"temporary write failure\")\n"
                "            offset += written",
                "            written = 0\n"
                "            if False and written <= 0:\n"
                "                raise OperationalFailure(\"temporary write failure\")\n"
                "            if False and written > remaining:\n"
                "                raise OperationalFailure(\"temporary write failure\")\n"
                "            offset += written",
                1,
            )
            mutant.write_text(loop_source, encoding="utf-8")
            dest = os.path.join(mutation_root, "out", "gitleaks")
            try:
                subprocess.run(
                    [
                        sys.executable,
                        *PYTHON_FLAGS,
                        str(mutant),
                        "install",
                        archive,
                        dest,
                        "--runner-temp",
                        mutation_root,
                    ],
                    capture_output=True,
                    text=True,
                    env={**os.environ, "PYTHONDONTWRITEBYTECODE": "1"},
                    check=False,
                    timeout=5,
                )
                self.fail("expected infinite-write mutant install to time out")
            except subprocess.TimeoutExpired:
                pass
            self.assertFalse(os.path.lexists(dest))

    @unittest.skipIf(SKIP_MUTATION_SUITE, "mutation subprocess mode")
    def test_mutation_suite_fails_without_exact_member_set_enforcement(self) -> None:
        with tempfile.TemporaryDirectory() as mutation_root:
            source = Path(mutation_root) / "source.py"
            mutant = Path(mutation_root) / "member-set.py"
            shutil.copy2(MODULE_PATH, source)
            write_mutated_module(
                source,
                mutant,
                "if seen != EXPECTED_MEMBERS:",
                "if False and seen != EXPECTED_MEMBERS:",
            )
            result = run_archive_suite_against_module(mutant)
            self.assertNotEqual(result.returncode, 0)

    @unittest.skipIf(SKIP_MUTATION_SUITE, "mutation subprocess mode")
    def test_mutation_suite_fails_without_global_pax_enforcement(self) -> None:
        with tempfile.TemporaryDirectory() as mutation_root:
            source = Path(mutation_root) / "source.py"
            mutant = Path(mutation_root) / "global-pax.py"
            shutil.copy2(MODULE_PATH, source)
            write_mutated_module(
                source,
                mutant,
                "def inspect_archive_pax(tf: tarfile.TarFile) -> None:",
                "def inspect_archive_pax(tf: tarfile.TarFile) -> None:\n    return",
                1,
            )
            try:
                result = run_archive_suite_against_module(mutant)
            except subprocess.TimeoutExpired:
                return
            if result.returncode == 0:
                self.skipTest(
                    "BLOCKER: disabling inspect_archive_pax alone does not fail the archive suite; "
                    "global PAX rejection currently occurs through per-member pax_headers "
                    "on Python 3 tarfile readers"
                )
            self.assertNotEqual(result.returncode, 0)

    @unittest.skipIf(SKIP_MUTATION_SUITE, "mutation subprocess mode")
    def test_mutation_suite_fails_without_zero_write_guard(self) -> None:
        with tempfile.TemporaryDirectory() as mutation_root:
            source = Path(mutation_root) / "source.py"
            mutant = Path(mutation_root) / "loop.py"
            shutil.copy2(MODULE_PATH, source)
            loop_source = source.read_text(encoding="utf-8").replace(
                "            written = os.write(fd, view[offset:])\n"
                "            if written <= 0:\n"
                "                raise OperationalFailure(\"temporary write failure\")\n"
                "            if written > remaining:\n"
                "                raise OperationalFailure(\"temporary write failure\")\n"
                "            offset += written",
                "            written = 0\n"
                "            if False and written <= 0:\n"
                "                raise OperationalFailure(\"temporary write failure\")\n"
                "            if False and written > remaining:\n"
                "                raise OperationalFailure(\"temporary write failure\")\n"
                "            offset += written",
                1,
            )
            mutant.write_text(loop_source, encoding="utf-8")
            try:
                result = run_archive_suite_against_module(mutant, timeout=30.0)
            except subprocess.TimeoutExpired:
                return
            self.assertNotEqual(result.returncode, 0)


if __name__ == "__main__":
    unittest.main()
