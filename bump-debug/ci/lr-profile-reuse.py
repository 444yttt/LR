#!/usr/bin/env python3
"""Issue only a bounded existing-wildcard profile using LR's existing ASC API key.

This worker uses a pinned PUBLIC signing key to identify the existing Y3 POS
distribution certificate. It never accepts, extracts or retrieves an application
signing private key or P12, and never signs an app.
"""

from __future__ import annotations

import argparse
import base64
import datetime as dt
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import tempfile


REPOSITORY = "444yttt/LR"
REF = "refs/heads/garage-monitor/ios-ad-hoc"
EXPECTED_SPKI_SHA256 = "5f7804d05c748b146b49c5dfb63ccdad404b5d1d0136a334e808a2cc9f3a1ddb"


class PublicCertificateError(RuntimeError):
    """An authored diagnostic that does not include secret/API contents."""


def require(condition, message):
    if not condition:
        raise PublicCertificateError(message)


def validate_ci_scope(repository, ref, source_commit):
    require(repository == REPOSITORY and ref == REF, "authorized_lr_ci_scope_required")
    require(isinstance(source_commit, str) and re.fullmatch(r"[0-9a-f]{40}", source_commit),
            "source_commit_missing")


def normalize_asc_key(environment):
    raw = environment.get("ASC_PRIVATE_KEY", "")
    encoded = environment.get("ASC_KEY_BASE64", "")
    require(isinstance(raw, str) and isinstance(encoded, str), "invalid_asc_key_input")
    require(len(raw) <= 65536 and len(encoded) <= 131072, "asc_key_input_too_large")

    def normalize(value):
        value = value.replace("\\n", "\n").strip() + "\n"
        require(value.startswith("-----BEGIN PRIVATE KEY-----\n")
                and value.endswith("\n-----END PRIVATE KEY-----\n")
                and value.count("-----BEGIN PRIVATE KEY-----") == 1
                and value.count("-----END PRIVATE KEY-----") == 1,
                "invalid_asc_private_key_pem")
        try:
            result = value.encode("ascii")
        except UnicodeEncodeError:
            raise PublicCertificateError("invalid_asc_private_key_encoding") from None
        require(len(result) <= 65536, "asc_key_input_too_large")
        return result

    raw_key = normalize(raw) if raw.strip() else None
    encoded_key = None
    if encoded.strip():
        try:
            decoded = base64.b64decode("".join(encoded.split()), validate=True).decode("ascii")
        except (ValueError, UnicodeDecodeError):
            raise PublicCertificateError("invalid_asc_base64_key") from None
        encoded_key = normalize(decoded)
    require(raw_key is not None or encoded_key is not None, "existing_lr_asc_key_missing")
    require(raw_key is None or encoded_key is None or raw_key == encoded_key,
            "ambiguous_existing_lr_asc_keys")
    return raw_key if raw_key is not None else encoded_key


def normalize_public_spki(module, public_key):
    require(isinstance(public_key, bytes) and 1 <= len(public_key) <= 16384,
            "invalid_staged_public_key")
    require(public_key.startswith(b"-----BEGIN PUBLIC KEY-----")
            and b"PRIVATE KEY" not in public_key and b"CERTIFICATE" not in public_key,
            "staged_input_must_be_public_key_only")
    spki = module.run(["openssl", "pkey", "-pubin", "-pubout", "-outform", "DER"], public_key)
    require(hashlib.sha256(spki).hexdigest() == EXPECTED_SPKI_SHA256,
            "staged_existing_public_key_pin_mismatch")
    return spki


def certificate_spki(module, der):
    pem = module.run(["openssl", "x509", "-inform", "DER", "-pubkey", "-noout"], der)
    return module.run(["openssl", "pkey", "-pubin", "-pubout", "-outform", "DER"], pem)


def validate_certificate_der(module, der, team, now=None):
    """Check public certificate validity and team without publishing its subject."""
    now = now or dt.datetime.now(dt.timezone.utc)
    output = module.run(["openssl", "x509", "-inform", "DER", "-noout", "-startdate", "-enddate",
                         "-subject", "-nameopt", "RFC2253"], der)
    try:
        text = output.decode("ascii")
        values = dict(line.split("=", 1) for line in text.splitlines() if "=" in line)
        start = dt.datetime.strptime(values["notBefore"], "%b %d %H:%M:%S %Y %Z").replace(tzinfo=dt.timezone.utc)
        expiry = dt.datetime.strptime(values["notAfter"], "%b %d %H:%M:%S %Y %Z").replace(tzinfo=dt.timezone.utc)
        subject = values["subject"].strip()
    except (ValueError, KeyError, UnicodeDecodeError):
        raise PublicCertificateError("invalid_existing_public_certificate") from None
    require(start <= now < expiry, "existing_public_certificate_not_current")
    teams = re.findall(r"(?:^|,)OU=([A-Z0-9]{10})(?=,|$)", subject)
    require(teams == [team], "existing_public_certificate_team_mismatch")
    require(re.search(r"(?:^|,)CN=(?:Apple|iPhone) Distribution(?:[^,]*)(?:,|$)", subject),
            "existing_public_certificate_not_distribution")


def select_public_certificate(module, catalog, expected_spki, team):
    require(isinstance(catalog, list), "invalid_existing_certificate_catalog")
    require(isinstance(team, str) and re.fullmatch(r"[A-Z0-9]{10}", team), "invalid_existing_team_scope")
    selected = []
    for candidate in catalog:
        attributes = candidate.get("attributes", {}) if isinstance(candidate, dict) else {}
        if attributes.get("certificateType") not in ("IOS_DISTRIBUTION", "DISTRIBUTION"):
            continue
        if not module.helper.is_future(attributes.get("expirationDate")):
            continue
        content = attributes.get("certificateContent")
        if not isinstance(content, str) or len(content) > 2 * 1024 * 1024:
            continue
        try:
            der = module.helper.decode_base64(content)
            require(isinstance(der, bytes) and 1 <= len(der) <= 1024 * 1024,
                    "invalid_existing_certificate_content")
            if certificate_spki(module, der) != expected_spki:
                continue
            validate_certificate_der(module, der, team)
        except (RuntimeError, ValueError, TypeError, KeyError):
            continue
        selected.append((candidate, der))
    require(len(selected) == 1, "matching_existing_public_distribution_certificate_not_unique")
    return selected[0]


def load_bump_wrapper():
    path = Path(__file__).with_name("bump-resign.py")
    require(path.is_file() and not path.is_symlink(), "reviewed_bump_wrapper_missing")
    spec = importlib.util.spec_from_file_location("lr_bump_profile_wrapper", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--helper-directory", type=Path, default=Path("scripts"))
    parser.add_argument("--public-key", type=Path, default=Path("existing-ci-public-key.pem"))
    args = parser.parse_args(argv)
    validate_ci_scope(os.environ.get("GITHUB_REPOSITORY"), os.environ.get("GITHUB_REF"), os.environ.get("GITHUB_SHA"))
    bump = load_bump_wrapper()
    module = bump.load_signer(args.helper_directory)
    module.configure_openssl()
    module.helper = module.load_helper()
    require(args.public_key.is_file() and not args.public_key.is_symlink(), "staged_public_key_missing")
    expected_spki = normalize_public_spki(module, args.public_key.read_bytes())
    team = os.environ.get("APPLE_TEAM_ID", "")
    require(re.fullmatch(r"[A-Z0-9]{10}", team), "existing_lr_team_missing")
    require(os.environ.get("ASC_KEY_ID") and os.environ.get("ASC_ISSUER_ID"), "existing_lr_asc_identifiers_missing")
    key_bytes = normalize_asc_key(os.environ)
    with tempfile.TemporaryDirectory(prefix="lr-bump-profile-", dir=os.environ["RUNNER_TEMP"]) as directory:
        root = Path(directory)
        asc = module.private(root / "AuthKey.p8", key_bytes)
        key_bytes = b""
        module.run(["openssl", "pkey", "-in", str(asc), "-check", "-noout"])
        underlying = module.RefreshingAppleAPI(asc)
        read_only = bump.ReadOnlyAPI(underlying)
        certificate, der = select_public_certificate(module, read_only.collection("/v1/certificates"), expected_spki, team)
        validated_certificate, device = module.signing_readiness(read_only, der)
        require(validated_certificate.get("id") == certificate.get("id"), "existing_certificate_changed_during_readiness")
        # This credential-independent core owns the existing proof and one-POST
        # guard. Do not call decode_identity or pretend LR holds the signing key.
        receipt = bump.prepare_existing_wildcard_with_assets(module, underlying, der, validated_certificate, device,
                    team, os.environ["GITHUB_SHA"], output_directory=Path("bump-public"),
                    identity_role="existing_ci_public_certificate")
        receipt = dict(receipt)
        receipt.update({"mode": "existing_wildcard_profile_public_certificate_only",
                        "public_certificate_validated": True,
                        "private_signing_key_remains_in": "444yttt/Y3POSClient CI",
                        "lr_holds_application_signing_private_key": False,
                        "app_signing_performed": False,
                        "signed_ipa_created": False})
        receipt.pop("signing_identity_role", None)
        output = Path("bump-public")
        output.mkdir(exist_ok=True)
        (output / "readiness.json").write_text(json.dumps(receipt, indent=2) + "\n")
    print("Existing public distribution certificate validated; bounded wildcard profile preparation completed. "
          "Application signing key remains in Y3POSClient CI; LR performed no app signing.")
    return receipt


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        # OpenSSL, Apple response bodies, profile/device IDs and ASC inputs must
        # not enter logs. Wrapper-authored safe diagnostics are fixed codes.
        if isinstance(error, PublicCertificateError):
            diagnostic = str(error)
        else:
            try:
                diagnostic = load_bump_wrapper().safe_failure(error)
            except Exception:
                diagnostic = type(error).__name__
        print("LR public-certificate profile preparation failed: " + diagnostic, file=__import__('sys').stderr)
        raise SystemExit(1) from None
