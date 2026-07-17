"""Fuzzy tower/unit/area matching — the "Fuzzy Perfect Match" comparators.

Pure logic, no DB. These thresholds are the whole safety story for fuzzy
matching, so the pairs below are the contract: the typos we must catch, and the
genuinely-different units we must never flag. OHLNC1245 ("Tullip" vs a live
"Tulip") is the case that motivated all of this.
"""

from duplicate_check import (
    _area_close,
    _fuzzy_row_match,
    _fuzzy_tower_eq,
    _fuzzy_unit_eq,
    _norm_area,
)


def test_tower_catches_typos():
    assert _fuzzy_tower_eq("Tullip", "Tulip")      # the OHLNC1245 bug
    assert _fuzzy_tower_eq("Tulip", "Tulips")
    assert _fuzzy_tower_eq(" tulip ", "TULIP")     # exact after normalization
    assert _fuzzy_tower_eq("T-05", "T5")           # separators + leading zeros


def test_tower_rejects_different_towers():
    # Digits in a tower name are identity, never spelling.
    assert not _fuzzy_tower_eq("T1", "T2")
    assert not _fuzzy_tower_eq("Tower 11", "Tower 12")
    assert not _fuzzy_tower_eq("Tulip", "Aster")
    assert not _fuzzy_tower_eq("Aster", "Astor")
    assert not _fuzzy_tower_eq("Tower A", "Tower B")
    assert not _fuzzy_tower_eq("Tulip", None)
    assert not _fuzzy_tower_eq("", "Tulip")


def test_unit_catches_typos():
    assert _fuzzy_unit_eq("5066", "506")           # doubled digit
    assert _fuzzy_unit_eq("506A", "506")
    assert _fuzzy_unit_eq("0506", "506")


def test_unit_rejects_different_flats():
    # One character apart but a completely different flat — this is the pair
    # that must never fuzzy-match.
    assert not _fuzzy_unit_eq("506", "508")
    assert not _fuzzy_unit_eq("101", "102")
    assert not _fuzzy_unit_eq("1102", "1103")
    assert not _fuzzy_unit_eq("506", "560")        # transposition = a real unit
    assert not _fuzzy_unit_eq("506", None)


def test_area_normalizes_overlong_digits():
    # Areas are 3- or 4-digit; anything longer is a fat-fingered extra digit.
    assert _norm_area(15001) == 1500
    assert _norm_area("16501") == 1650
    assert _norm_area("1650") == 1650
    assert _norm_area("650") == 650
    assert _norm_area(None) is None
    assert _norm_area("") is None


def test_area_corroborates():
    assert _area_close(1650, 1650)
    assert _area_close(1650, 1655)                 # same unit, quoted loosely
    assert _area_close(15001, 1500)                # typo'd side normalizes
    assert not _area_close(1650, 1200)
    # Missing on either side can't corroborate, but must not veto.
    assert _area_close(None, 1650)
    assert _area_close(1650, None)


def test_row_match_requires_all_three():
    live = {"tower": "Tulip", "unit_no": "506", "sqft": 1650}
    # The real OHLNC1245 payload.
    assert _fuzzy_row_match(live, "submissions", "Tullip", "506", 1650)
    # Any one field disagreeing kills the match.
    assert not _fuzzy_row_match(live, "submissions", "Aster", "506", 1650)
    assert not _fuzzy_row_match(live, "submissions", "Tullip", "508", 1650)
    assert not _fuzzy_row_match(live, "submissions", "Tullip", "506", 1200)


def test_row_match_reads_properties_column_names():
    prop = {"tower_no": "Tulip", "unit_no": "506", "area_sqft": 1650}
    assert _fuzzy_row_match(prop, "properties", "Tullip", "506", 1650)
    # Wrong source => wrong column names => no tower value => no match.
    assert not _fuzzy_row_match(prop, "submissions", "Tullip", "506", 1650)
