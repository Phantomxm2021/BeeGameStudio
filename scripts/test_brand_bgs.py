import importlib.util
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('branding', Path(__file__).with_name('brand-bgs.py'))
branding = importlib.util.module_from_spec(spec)
spec.loader.exec_module(branding)

class BrandingTests(unittest.TestCase):
    def test_protocol_and_internal_names_stay_upstream(self):
        text = 'CodexErrorInfo codex_error_info codexErrorInfo codex/imageDetail codex/encryptedContent mcp__codex_apps__user_messaging__send_message Product::Codex "CODEX" "codex" .codex-plugin gpt-5.3-codex x-codex-turn-state'
        self.assertEqual(branding.transform(text, 'codex-rs/protocol/src/models.rs'), text)

    def test_home_names_only(self):
        text = 'find_codex_home std::env::var("CODEX_HOME") p.push(".codex");'
        self.assertEqual(branding.transform(text, 'codex-rs/utils/home-dir/src/lib.rs'),
                         'find_codex_home std::env::var("BGS_HOME") p.push(".bgs");')
        self.assertEqual(branding.transform('command.env("CODEX_HOME", home)', 'codex-rs/app-server-daemon/src/background_command.rs'),
                         'command.env("BGS_HOME", home)')

    def test_execution_and_model_metadata_are_not_rewritten(self):
        text = 'include_skills_usage_instructions: false; update_goal; active_goal_id = None; CODEX_HOME_SUFFIX; ~/.codex;'
        for path in ['codex-rs/models-manager/src/model_info.rs', 'codex-rs/ext/goal/src/tool.rs', 'codex-rs/core/src/state/additional_context.rs']:
            self.assertEqual(branding.transform(text, path), text)

    def test_bgs_configuration_is_separate_from_codex(self):
        self.assertEqual(branding.transform('dir.join(".codex") .codex-plugin "codex/imageDetail"', 'codex-rs/config/src/loader/mod.rs'),
                         'dir.join(".bgs") .codex-plugin "codex/imageDetail"')
        self.assertEqual(branding.transform('"/etc/codex/config.toml" data.join("OpenAI").join("Codex")', 'codex-rs/config/src/loader/mod.rs'),
                         '"/etc/bgs/config.toml" data.join("PhantomLab").join("BGS")')
        self.assertEqual(branding.transform('"com.openai.codex"', 'codex-rs/config/src/loader/macos.rs'), '"com.phantomlab.bgs"')
        paths = '".codex/config.toml" "file:///C:/workspace/.codex/config" https://example.com/.codex/config.toml'
        self.assertEqual(branding.transform(paths, 'codex-rs/protocol/src/permissions.rs'),
                         '".bgs/config.toml" "file:///C:/workspace/.bgs/config" https://example.com/.codex/config.toml')

    def test_idempotence(self):
        original = 'std::env::var("CODEX_HOME"); p.push(".codex");'
        path = 'codex-rs/utils/home-dir/src/lib.rs'
        once = branding.transform(original, path)
        self.assertEqual(branding.transform(once, path), once)

if __name__ == '__main__':
    unittest.main()
