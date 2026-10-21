import importlib.util
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('branding', Path(__file__).with_name('brand-bgs.py'))
branding = importlib.util.module_from_spec(spec)
spec.loader.exec_module(branding)

class BrandingTests(unittest.TestCase):
    def test_names_and_home(self):
        self.assertEqual(branding.transform('CodexClient codex_home CODEX_HOME .codex/skills codex-cli'),
                         'BgsClient bgs_home BGS_HOME .bgs/skills bgs-cli')

    def test_external_contracts_and_interpolation(self):
        contracts = ['https://chatgpt.com/backend-api/codex/responses', 'gpt-5.3-codex',
                     'x-codex-primary-used-percent', '.codex-plugin/plugin.json', 'OpenAI Codex',
                     '"missing_codex_entitlement"', '"codex_streamlined_login"']
        for value in contracts:
            self.assertEqual(branding.transform(value), value)
        self.assertEqual(branding.transform('http://localhost:{codex_oss_port}/v1'),
                         'http://localhost:{bgs_oss_port}/v1')
        self.assertEqual(branding.transform('"codex_model_provider_info"', name='model-provider-info/Cargo.toml'),
                         '"bgs_model_provider_info"')

    def test_backend_and_host_routes_are_distinct(self):
        self.assertEqual(branding.transform('/api/codex/usage'), '/api/codex/usage')
        self.assertEqual(branding.transform('/api/codex/settings', False), '/api/bgs/settings')

    def test_idempotence(self):
        original = 'CODEX_HOME CodexClient codex-rs .codex .codex-plugin https://github.com/openai/codex gpt-5.3-codex'
        once = branding.transform(original)
        self.assertEqual(branding.transform(once), once)

if __name__ == '__main__':
    unittest.main()
