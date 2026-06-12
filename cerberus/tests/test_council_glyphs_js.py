"""Tests for council-glyphs.js via static file content inspection.

Verifies:
  - File exists and contains GLYPHS export
  - All 6 Greek names are defined
  - getGlyph function is exported
  - SVG viewbox constant is exported
  - No CDN dependencies
"""

import pathlib

_GLYPHS_FILE = pathlib.Path(
    'static/js/cyberapps/command-center/council-glyphs.js'
)


def _content():
    return _GLYPHS_FILE.read_text()


def test_glyphs_file_exists():
    assert _GLYPHS_FILE.exists(), 'council-glyphs.js not found'


def test_all_greek_personas_defined():
    txt = _content()
    for name in ('DAEDALUS', 'HEPHAESTUS', 'THEMIS', 'ARGUS', 'ATHENA', 'AEGIS'):
        assert name in txt, f'Missing glyph definition for {name}'


def test_getglyph_exported():
    assert 'export function getGlyph' in _content()


def test_glyphs_map_exported():
    assert 'export const GLYPHS' in _content()


def test_glyph_viewbox_exported():
    assert 'export const GLYPH_VIEWBOX' in _content()


def test_no_cdn_dependency():
    txt = _content()
    assert 'cdn.jsdelivr' not in txt
    assert 'unpkg.com' not in txt
    assert 'https://' not in txt.split('export')[0]  # no CDN before exports


def test_uses_currentcolor():
    """Glyphs use currentColor so CSS can tint them via theme."""
    assert 'currentColor' in _content()


def test_file_under_500_lines():
    lines = _content().splitlines()
    assert len(lines) < 500, f'File is {len(lines)} lines (limit 500)'
