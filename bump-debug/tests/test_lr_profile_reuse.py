import base64
import hashlib
import importlib.util
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest import mock


PATH = Path(__file__).resolve().parents[1] / 'ci' / 'lr-profile-reuse.py'
SPEC = importlib.util.spec_from_file_location('lr_public_profile_worker', PATH)
WORKER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(WORKER)


def certificate(identity='CERT1', der=b'matching-public-certificate', kind='DISTRIBUTION', expiry='future'):
    return {'id': identity, 'type': 'certificates', 'attributes': {
        'certificateType': kind, 'expirationDate': expiry,
        'certificateContent': base64.b64encode(der).decode()}}


class CertificateSelectionTests(unittest.TestCase):
    def setUp(self):
        self.module = SimpleNamespace(helper=SimpleNamespace(
            is_future=lambda value: value == 'future', decode_base64=lambda value: base64.b64decode(value, validate=True)))
        self.spki = b'pinned public SPKI'

    def choose(self, catalog):
        def spki(module, der):
            return self.spki if der.startswith(b'matching') else b'another-key'
        with mock.patch.object(WORKER, 'certificate_spki', side_effect=spki), \
                mock.patch.object(WORKER, 'validate_certificate_der') as validate:
            result = WORKER.select_public_certificate(self.module, catalog, self.spki, 'TESTTEAM00')
        return result, validate

    def test_selects_unique_current_distribution_public_key(self):
        selected, validate = self.choose([
            certificate('OTHER', der=b'other-certificate'), certificate('DEV', kind='IOS_DEVELOPMENT'),
            certificate('OLD', expiry='past'), certificate()])
        self.assertEqual(selected[0]['id'], 'CERT1')
        self.assertEqual(selected[1], b'matching-public-certificate')
        validate.assert_called_once_with(self.module, b'matching-public-certificate', 'TESTTEAM00')

    def test_multiple_active_matching_certificates_rejected(self):
        with self.assertRaisesRegex(WORKER.PublicCertificateError, 'not_unique'):
            self.choose([certificate('CERT1'), certificate('CERT2', der=b'matching-renewed')])

    def test_expired_development_wrong_key_and_invalid_content_not_selected(self):
        cases = [[certificate(expiry='past')], [certificate(kind='IOS_DEVELOPMENT')],
                 [certificate(der=b'wrong-public-key')], []]
        for catalog in cases:
            with self.subTest(catalog=catalog), self.assertRaisesRegex(WORKER.PublicCertificateError, 'not_unique'):
                self.choose(catalog)

    def test_matching_spki_still_requires_current_certificate_and_team_validation(self):
        with mock.patch.object(WORKER, 'certificate_spki', return_value=self.spki), \
                mock.patch.object(WORKER, 'validate_certificate_der', side_effect=WORKER.PublicCertificateError('team_mismatch')):
            with self.assertRaisesRegex(WORKER.PublicCertificateError, 'not_unique'):
                WORKER.select_public_certificate(self.module, [certificate()], self.spki, 'TESTTEAM00')

    def test_public_key_file_must_match_fixed_existing_pin(self):
        module = SimpleNamespace(run=mock.Mock(return_value=b'different-SPKI'))
        with self.assertRaisesRegex(WORKER.PublicCertificateError, 'pin_mismatch'):
            WORKER.normalize_public_spki(module, b'-----BEGIN PUBLIC KEY-----\nTEST\n-----END PUBLIC KEY-----\n')
        for value in (b'-----BEGIN PRIVATE KEY-----\nTEST', b'-----BEGIN CERTIFICATE-----\nTEST'):
            with self.subTest(value=value[:20]), self.assertRaises(WORKER.PublicCertificateError):
                WORKER.normalize_public_spki(module, value)


class CredentialAndScopeTests(unittest.TestCase):
    PEM = '-----BEGIN PRIVATE KEY-----\nTESTONLY\n-----END PRIVATE KEY-----\n'

    def test_only_canonical_lr_branch_and_exact_source_sha_allowed(self):
        WORKER.validate_ci_scope('444yttt/LR', 'refs/heads/garage-monitor/ios-ad-hoc', 'a' * 40)
        cases = [('444yttt/LR', 'refs/heads/main', 'a' * 40),
                 ('444yttt/Y3POSClient', WORKER.REF, 'a' * 40),
                 ('attacker/LR', WORKER.REF, 'a' * 40),
                 (WORKER.REPOSITORY, WORKER.REF, 'main'),
                 (WORKER.REPOSITORY, WORKER.REF, 'g' * 40)]
        for repository, ref, sha in cases:
            with self.subTest(repository=repository, ref=ref, sha=sha), self.assertRaises(WORKER.PublicCertificateError):
                WORKER.validate_ci_scope(repository, ref, sha)

    def test_raw_escaped_or_base64_asc_key_normalized_without_p12(self):
        raw = WORKER.normalize_asc_key({'ASC_PRIVATE_KEY': self.PEM.replace('\n', '\\n')})
        encoded = WORKER.normalize_asc_key({'ASC_KEY_BASE64': base64.b64encode(self.PEM.encode()).decode()})
        self.assertEqual(raw, self.PEM.encode())
        self.assertEqual(encoded, raw)
        self.assertEqual(WORKER.normalize_asc_key({'ASC_PRIVATE_KEY': self.PEM,
                         'ASC_KEY_BASE64': base64.b64encode(self.PEM.encode()).decode()}), raw)

    def test_missing_mismatched_and_malformed_asc_keys_rejected(self):
        cases = [{}, {'ASC_KEY_BASE64': 'bad%base64'}, {'ASC_PRIVATE_KEY': 'not a key'},
                 {'ASC_PRIVATE_KEY': self.PEM,
                  'ASC_KEY_BASE64': base64.b64encode(self.PEM.replace('TESTONLY', 'OTHER').encode()).decode()}]
        for environment in cases:
            with self.subTest(keys=sorted(environment)), self.assertRaises(WORKER.PublicCertificateError):
                WORKER.normalize_asc_key(environment)

    def test_public_certificate_dates_and_team_checked_without_exposing_subject(self):
        import datetime as dt
        now = dt.datetime(2026, 11, 27, tzinfo=dt.timezone.utc)
        fixture = b'notBefore=Nov 26 00:00:00 2026 GMT\nnotAfter=Nov 28 00:00:00 2026 GMT\nsubject=OU=TESTTEAM00,CN=Apple Distribution Test\n'
        module = SimpleNamespace(run=mock.Mock(return_value=fixture))
        WORKER.validate_certificate_der(module, b'public-cert', 'TESTTEAM00', now)
        with self.assertRaisesRegex(WORKER.PublicCertificateError, 'team_mismatch'):
            WORKER.validate_certificate_der(module, b'public-cert', 'OTHERTEAM0', now)
        with self.assertRaisesRegex(WORKER.PublicCertificateError, 'not_current'):
            WORKER.validate_certificate_der(module, b'public-cert', 'TESTTEAM00', now + dt.timedelta(days=2))


if __name__ == '__main__':
    unittest.main()
