#!/usr/bin/env python3
"""Pinned Gitleaks archive validation and safe installation — stdlib only."""

from __future__ import annotations

import argparse
import hashlib
import os
import re
import secrets
import sys
import tarfile

ACCEPT = 0
POLICY = 10
OPERATIONAL = 20

EXPECTED_MEMBERS = frozenset({"LICENSE", "README.md", "gitleaks"})
ALLOWED_MEMBER_TYPES = frozenset({tarfile.REGTYPE, tarfile.AREGTYPE})
FORBIDDEN_MEMBER_TYPES = frozenset(
    {
        tarfile.CONTTYPE,
        tarfile.GNUTYPE_SPARSE,
        tarfile.SYMTYPE,
        tarfile.LNKTYPE,
        tarfile.DIRTYPE,
        tarfile.CHRTYPE,
        tarfile.BLKTYPE,
        tarfile.FIFOTYPE,
        tarfile.XHDTYPE,
        tarfile.XGLTYPE,
        tarfile.GNUTYPE_LONGNAME,
        tarfile.GNUTYPE_LONGLINK,
    }
)
MAX_MEMBER_SIZE = 256 * 1024 * 1024
GITLEAKS_MEMBER = "gitleaks"
DIGEST_PATTERN = re.compile(r"^[a-f0-9]{64}$")


class ArchiveError(Exception):
    """Base archive handling error."""


class PolicyViolation(ArchiveError):
    """Archive inspected and rejected for policy violation."""


class OperationalFailure(ArchiveError):
    """Operational, filesystem, or runtime failure."""


class GovernanceArgumentParser(argparse.ArgumentParser):
    def exit(self, status: int = 0, message: str | None = None) -> None:
        if status == 0:
            raise SystemExit(ACCEPT)
        raise SystemExit(OPERATIONAL)

    def error(self, message: str) -> None:
        raise SystemExit(OPERATIONAL)


def policy_exit() -> None:
    raise SystemExit(POLICY)


def operational_exit() -> None:
    raise SystemExit(OPERATIONAL)


def validate_member_name(name: str) -> None:
    if not name or name != name.strip():
        raise PolicyViolation("invalid member name")
    if name.startswith("/"):
        raise PolicyViolation("absolute member name")
    parts = name.split("/")
    if len(parts) != 1:
        raise PolicyViolation("nested member name")
    if ".." in parts:
        raise PolicyViolation("traversal member name")
    if parts[0].startswith("."):
        raise PolicyViolation("dot-prefixed member name")


def inspect_member(info: tarfile.TarInfo) -> None:
    validate_member_name(info.name)
    if info.type in FORBIDDEN_MEMBER_TYPES:
        raise PolicyViolation("forbidden member type")
    if info.type not in ALLOWED_MEMBER_TYPES:
        raise PolicyViolation("unsupported member type")
    if info.size <= 0 or info.size > MAX_MEMBER_SIZE:
        raise PolicyViolation("invalid member size")
    pax_headers = getattr(info, "pax_headers", None) or {}
    if pax_headers:
        raise PolicyViolation("per-member pax metadata")
    sparse = getattr(info, "sparse", None)
    if sparse:
        raise PolicyViolation("sparse member metadata")


def inspect_archive_pax(tf: tarfile.TarFile) -> None:
    global_pax = getattr(tf, "_pax_global_headers", None) or {}
    if global_pax:
        raise PolicyViolation("archive pax metadata")


def inspect_members(members: list[tarfile.TarInfo]) -> None:
    if len(members) != 3:
        raise PolicyViolation("unexpected member count")

    seen: set[str] = set()
    for info in members:
        inspect_member(info)
        if info.name in seen:
            raise PolicyViolation("duplicate member name")
        seen.add(info.name)

    if seen != EXPECTED_MEMBERS:
        raise PolicyViolation("unexpected member set")


def verify_regular_readable_file(path: str) -> None:
    try:
        if not os.path.isfile(path):
            raise OperationalFailure("archive is not a regular file")
        if not os.access(path, os.R_OK):
            raise OperationalFailure("archive is not readable")
        if os.path.getsize(path) <= 0:
            raise OperationalFailure("archive is empty")
    except OSError as exc:
        raise OperationalFailure("archive access failure") from exc


def open_archive(path: str) -> tarfile.TarFile:
    verify_regular_readable_file(path)
    try:
        return tarfile.open(path, mode="r:gz")
    except tarfile.TarError as exc:
        raise PolicyViolation("malformed archive") from exc
    except OSError as exc:
        raise OperationalFailure("archive open failure") from exc
    except Exception as exc:
        raise OperationalFailure("unexpected archive open failure") from exc


def read_members(tf: tarfile.TarFile) -> list[tarfile.TarInfo]:
    try:
        members = tf.getmembers()
        inspect_archive_pax(tf)
        return members
    except ArchiveError:
        raise
    except tarfile.TarError as exc:
        raise PolicyViolation("malformed archive listing") from exc
    except Exception as exc:
        raise OperationalFailure("unexpected archive listing failure") from exc


def validate_archive(path: str) -> None:
    tf = open_archive(path)
    try:
        with tf:
            inspect_members(read_members(tf))
    except ArchiveError:
        raise
    except Exception as exc:
        raise OperationalFailure("unexpected validation failure") from exc


def normalize_digest(expected: str) -> str:
    digest = expected.strip().lower()
    if not DIGEST_PATTERN.fullmatch(digest):
        raise OperationalFailure("invalid digest")
    return digest


def verify_archive_digest(path: str, expected: str) -> None:
    verify_regular_readable_file(path)
    digest = normalize_digest(expected)
    hasher = hashlib.sha256()
    try:
        with open(path, "rb") as handle:
            while True:
                chunk = handle.read(1024 * 1024)
                if not chunk:
                    break
                hasher.update(chunk)
    except OSError as exc:
        raise OperationalFailure("archive digest failure") from exc
    except Exception as exc:
        raise OperationalFailure("unexpected digest failure") from exc

    if hasher.hexdigest() != digest:
        raise OperationalFailure("archive digest mismatch")


def resolve_runner_temp(root: str) -> str:
    try:
        if not root:
            raise OperationalFailure("runner temp missing")
        if os.path.islink(root):
            raise OperationalFailure("runner temp is symlink")
        resolved = os.path.abspath(root)
        if not os.path.isdir(resolved):
            raise OperationalFailure("runner temp is not a directory")
        if os.path.islink(resolved):
            raise OperationalFailure("runner temp resolves to symlink")
        return resolved
    except ArchiveError:
        raise
    except OSError as exc:
        raise OperationalFailure("runner temp resolution failure") from exc
    except Exception as exc:
        raise OperationalFailure("unexpected runner temp failure") from exc


def verify_destination(dest: str, runner_temp: str) -> tuple[str, str]:
    if os.path.basename(dest) != GITLEAKS_MEMBER:
        raise OperationalFailure("invalid destination basename")

    if os.path.lexists(dest):
        raise OperationalFailure("destination already exists")

    temp_root = resolve_runner_temp(runner_temp)
    runner_abs = os.path.abspath(runner_temp)
    dest_input_abs = os.path.abspath(dest)
    try:
        relative = os.path.relpath(dest_input_abs, runner_abs)
    except ValueError as exc:
        raise OperationalFailure("destination outside runner temp") from exc
    if relative.startswith(".."):
        raise OperationalFailure("destination outside runner temp")

    dest_abs = os.path.normpath(os.path.join(temp_root, relative))
    dest_dir = os.path.dirname(dest_abs)

    parent = dest_dir
    while parent != temp_root:
        if not parent.startswith(temp_root + os.sep) and parent != temp_root:
            break
        if os.path.islink(parent):
            raise OperationalFailure("destination parent is symlink")
        next_parent = os.path.dirname(parent)
        if next_parent == parent:
            break
        parent = next_parent

    dest_parent = os.path.dirname(os.path.normpath(dest_abs))
    if dest_parent.startswith(temp_root + os.sep) or dest_parent == temp_root:
        if os.path.islink(dest_parent):
            raise OperationalFailure("destination parent is symlink")

    if os.path.lexists(dest_abs):
        raise OperationalFailure("destination already exists")

    return dest_abs, dest_dir


def cleanup_paths(*paths: str) -> None:
    for path in paths:
        if not path:
            continue
        try:
            if os.path.lexists(path):
                os.unlink(path)
        except OSError:
            pass


def exclusive_temp_path(dest_dir: str) -> str:
    for _ in range(32):
        name = f".gitleaks-install.{os.getpid()}.{secrets.token_hex(8)}.tmp"
        candidate = os.path.join(dest_dir, name)
        flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
        if hasattr(os, "O_NOFOLLOW"):
            flags |= os.O_NOFOLLOW
        try:
            fd = os.open(candidate, flags, 0o600)
            os.close(fd)
            return candidate
        except FileExistsError:
            continue
        except OSError as exc:
            raise OperationalFailure("temporary file creation failure") from exc
    raise OperationalFailure("temporary file creation failure")


def read_gitleaks_payload(tf: tarfile.TarFile, members: list[tarfile.TarInfo]) -> bytes:
    gitleaks_info = next((info for info in members if info.name == GITLEAKS_MEMBER), None)
    if gitleaks_info is None:
        raise PolicyViolation("missing gitleaks member")

    extracted = tf.extractfile(gitleaks_info)
    if extracted is None:
        raise OperationalFailure("gitleaks member unreadable")

    try:
        payload = extracted.read()
    except Exception as exc:
        raise OperationalFailure("gitleaks member read failure") from exc
    finally:
        extracted.close()

    if not payload:
        raise PolicyViolation("empty gitleaks member")

    return payload


def write_temp_payload(temp_path: str, payload: bytes) -> None:
    flags = os.O_WRONLY
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    fd = os.open(temp_path, flags)
    try:
        view = memoryview(payload)
        offset = 0
        total = len(view)
        while offset < total:
            remaining = total - offset
            written = os.write(fd, view[offset:])
            if written <= 0:
                raise OperationalFailure("temporary write failure")
            if written > remaining:
                raise OperationalFailure("temporary write failure")
            offset += written
    except OSError as exc:
        raise OperationalFailure("temporary write failure") from exc
    finally:
        os.close(fd)


def publish_temp_file(temp_path: str, dest_abs: str) -> None:
    try:
        os.chmod(temp_path, 0o755)
    except OSError as exc:
        raise OperationalFailure("permission failure") from exc

    try:
        os.link(temp_path, dest_abs)
    except OSError as exc:
        raise OperationalFailure("atomic publication failure") from exc

    try:
        os.unlink(temp_path)
    except OSError as exc:
        cleanup_paths(dest_abs)
        raise OperationalFailure("temporary cleanup failure") from exc

    try:
        if os.path.islink(dest_abs):
            cleanup_paths(dest_abs)
            raise OperationalFailure("published destination is symlink")
        if not os.path.isfile(dest_abs):
            cleanup_paths(dest_abs)
            raise OperationalFailure("published destination is not regular file")
        if os.path.getsize(dest_abs) <= 0:
            cleanup_paths(dest_abs)
            raise OperationalFailure("published destination is empty")
    except ArchiveError:
        raise
    except OSError as exc:
        cleanup_paths(dest_abs)
        raise OperationalFailure("published destination verification failure") from exc


def install_archive(path: str, dest: str, runner_temp: str) -> None:
    dest_abs, dest_dir = verify_destination(dest, runner_temp)
    temp_path = ""
    try:
        os.makedirs(dest_dir, exist_ok=True)
        tf = open_archive(path)
        with tf:
            members = read_members(tf)
            inspect_members(members)
            payload = read_gitleaks_payload(tf, members)

        temp_path = exclusive_temp_path(dest_dir)
        write_temp_payload(temp_path, payload)
        publish_temp_file(temp_path, dest_abs)
        temp_path = ""
    except ArchiveError:
        cleanup_paths(temp_path, dest_abs if os.path.lexists(dest_abs) else "")
        raise
    except Exception as exc:
        cleanup_paths(temp_path, dest_abs if os.path.lexists(dest_abs) else "")
        raise OperationalFailure("unexpected installation failure") from exc


def handle_archive_error(exc: ArchiveError) -> None:
    if isinstance(exc, PolicyViolation):
        policy_exit()
    operational_exit()


def cmd_validate(path: str) -> None:
    try:
        validate_archive(path)
    except ArchiveError as exc:
        handle_archive_error(exc)
    except Exception:
        operational_exit()
    raise SystemExit(ACCEPT)


def cmd_verify_digest(path: str, expected: str) -> None:
    try:
        verify_archive_digest(path, expected)
    except ArchiveError as exc:
        handle_archive_error(exc)
    except Exception:
        operational_exit()
    raise SystemExit(ACCEPT)


def cmd_install(path: str, dest: str, runner_temp: str) -> None:
    try:
        install_archive(path, dest, runner_temp)
    except ArchiveError as exc:
        handle_archive_error(exc)
    except Exception:
        operational_exit()
    raise SystemExit(ACCEPT)


def build_parser() -> GovernanceArgumentParser:
    parser = GovernanceArgumentParser(prog="gitleaks-archive")
    subparsers = parser.add_subparsers(dest="command", required=True)

    validate_parser = subparsers.add_parser("validate")
    validate_parser.add_argument("archive")

    verify_parser = subparsers.add_parser("verify-digest")
    verify_parser.add_argument("archive")
    verify_parser.add_argument("digest")

    install_parser = subparsers.add_parser("install")
    install_parser.add_argument("archive")
    install_parser.add_argument("dest")
    install_parser.add_argument("--runner-temp", required=True)

    return parser


def main(argv: list[str] | None = None) -> None:
    try:
        parser = build_parser()
        args = parser.parse_args(argv)
    except SystemExit as exc:
        if exc.code == ACCEPT:
            raise
        operational_exit()
    except Exception:
        operational_exit()

    try:
        if args.command == "validate":
            cmd_validate(args.archive)
        elif args.command == "verify-digest":
            cmd_verify_digest(args.archive, args.digest)
        elif args.command == "install":
            cmd_install(args.archive, args.dest, args.runner_temp)
        else:
            operational_exit()
    except SystemExit:
        raise
    except Exception:
        operational_exit()


if __name__ == "__main__":
    main()
