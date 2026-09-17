import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import release as r


class ReleaseTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / 'src-tauri').mkdir()
        for name in ('package.json', 'src-tauri/tauri.conf.json'):
            (self.root / name).write_text('{"version":"0.1.2"}')
        (self.root / 'Cargo.toml').write_text('[workspace.package]\nversion = "0.1.2"\n')
        (self.root / 'Cargo.lock').write_text(''.join(
            f'[[package]]\nname = "{name}"\nversion = "0.1.2"\n'
            for name in ('skill-studio', 'skill-studio-core', 'dependency')))
        (self.root / 'CHANGELOG.md').write_text('## v0.1.2\nFixed bugs.\n## v0.1.1\nOlder.\n')

    def assets(self):
        return [{'name': f'Skill.Studio_0.1.2_{suffix}', 'size': 1} for suffix in
                ('universal.dmg', 'x64-setup.exe', 'x64_en-US.msi', 'amd64.AppImage', 'amd64.deb')]

    def test_versions_and_notes(self):
        self.assertEqual(r.verify(self.root, 'v0.1.2'), '0.1.2')
        self.assertEqual(r.notes(self.root, '0.1.2'), 'Fixed bugs.')
        with self.assertRaises(ValueError):
            r.verify(self.root, 'v0.1.3')
        r.set_version(self.root, '0.1.3')
        self.assertEqual(set(r.versions(self.root).values()), {'0.1.3'})
        self.assertIn('name = "dependency"\nversion = "0.1.2"', (self.root / 'Cargo.lock').read_text())
        with self.assertRaises(ValueError):
            r.verify(self.root)

    def test_invalid_version_does_not_write(self):
        before = (self.root / 'package.json').read_text()
        for value in ('v0.1.3', '0.01.3', '1.2', '1.2.3-beta'):
            with self.assertRaises(ValueError):
                r.set_version(self.root, value)
        self.assertEqual(before, (self.root / 'package.json').read_text())

    def test_empty_duplicate_placeholder_notes(self):
        for text in ('## v0.1.2\n## v0.1.1\nOld\n', '## v0.1.2\nTODO\n',
                     '## v0.1.2\nA\n## v0.1.2\nB\n'):
            (self.root / 'CHANGELOG.md').write_text(text)
            with self.assertRaises(ValueError):
                r.notes(self.root, '0.1.2')

    def test_assets(self):
        r.check_assets(self.assets(), '0.1.2')
        for assets in (self.assets()[:-1], self.assets() * 2,
                       [dict(a, size=0) for a in self.assets()]):
            with self.assertRaises(ValueError):
                r.check_assets(assets, '0.1.2')
        with self.assertRaises(ValueError):
            r.check_assets(self.assets(), '0.1.3')

    def test_ci_requires_latest_exact_main_push(self):
        good = dict(databaseId=1, headSha='abc', headBranch='main', event='push',
                    status='completed', conclusion='success', url='url')
        self.assertEqual(r.successful_run([good], 'abc', 'main'), good)
        for runs in ([dict(good, headSha='other')], [dict(good, event='pull_request')],
                     [dict(good, headBranch='branch')],
                     [good, dict(good, databaseId=2, status='in_progress', conclusion=None)]):
            with self.assertRaises(ValueError):
                r.successful_run(runs, 'abc', 'main')

    @patch.object(r, 'verify', return_value='0.1.2')
    def test_dirty_tree_blocks_tag_mutation(self, verify):
        with patch.object(r, 'run', side_effect=['main', ' M file']) as run:
            with self.assertRaises(ValueError):
                r.publish_tag('0.1.2')
            self.assertFalse(any('tag' in c.args or 'push' in c.args for c in run.call_args_list))

    @patch.object(r, 'verify', return_value='0.1.2')
    def test_published_release_retry_does_not_mutate(self, verify):
        for a in self.assets():
            (self.root / a['name']).write_text('x')
        artifact_dir = self.root / 'artifacts'
        artifact_dir.mkdir()
        for a in self.assets():
            (self.root / a['name']).rename(artifact_dir / a['name'])
        with patch.object(r, 'gh', side_effect=[
            [{'tagName': 'v0.1.2'}],
            {'isDraft': False, 'isPrerelease': False, 'assets': self.assets()},
        ]), patch.object(r, 'run') as run:
            r.publish_assets(artifact_dir)
            run.assert_not_called()

    @patch.object(r, 'verify', return_value='0.1.2')
    def test_incomplete_upload_never_publishes(self, verify):
        folder = self.root / 'artifacts'
        folder.mkdir()
        for a in self.assets():
            (folder / a['name']).write_text('x')
        with patch.object(r, 'gh', side_effect=[
            [{'tagName': 'v0.1.2'}],
            {'isDraft': True, 'isPrerelease': False, 'assets': []},
            {'assets': self.assets()[:-1]},
        ]), patch.object(r, 'run') as run:
            with self.assertRaises(ValueError):
                r.publish_assets(folder)
            self.assertEqual(run.call_count, 1)
            self.assertEqual(run.call_args.args[:3], ('gh', 'release', 'upload'))

    @patch.object(r, 'verify', return_value='0.1.2')
    def test_failed_ci_never_creates_or_pushes_tag(self, verify):
        with patch.object(r, 'run', side_effect=[
            'main', '', f'git@github.com:{r.REPO}.git', '', 'sha', 'sha',
        ]) as run, patch.object(r, 'ci_gate', side_effect=ValueError('CI failed')):
            with self.assertRaises(ValueError):
                r.publish_tag('0.1.2')
            self.assertFalse(any('tag' in c.args or 'push' in c.args for c in run.call_args_list))


if __name__ == '__main__':
    unittest.main()
