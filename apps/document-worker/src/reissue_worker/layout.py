"""Positioned words and the line/segment structure every extractor works from.

All geometry is in PDF points with a top-left origin, matching PageInfo width/height.
"""

from __future__ import annotations

import statistics
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field
from itertools import pairwise
from typing import Literal

BBox = tuple[float, float, float, float]
PageParser = Literal["pdf_text", "ocr", "spreadsheet"]


@dataclass(frozen=True, slots=True)
class Word:
    text: str
    x0: float
    y0: float
    x1: float
    y1: float
    confidence: float = 1.0

    @property
    def cx(self) -> float:
        return (self.x0 + self.x1) / 2

    @property
    def cy(self) -> float:
        return (self.y0 + self.y1) / 2

    @property
    def height(self) -> float:
        return self.y1 - self.y0


@dataclass(slots=True)
class Line:
    words: list[Word]

    @property
    def text(self) -> str:
        return " ".join(w.text for w in self.words)

    @property
    def y0(self) -> float:
        return min(w.y0 for w in self.words)

    @property
    def y1(self) -> float:
        return max(w.y1 for w in self.words)

    @property
    def height(self) -> float:
        return statistics.median(w.height for w in self.words)


@dataclass(slots=True)
class PageLayout:
    number: int
    width: float
    height: float
    words: list[Word]
    parser: PageParser
    lines: list[Line] = field(default_factory=list)

    def __post_init__(self) -> None:
        if not self.lines:
            self.lines = group_lines(self.words)

    @property
    def text(self) -> str:
        return "\n".join(line.text for line in self.lines)

    @property
    def has_geometry(self) -> bool:
        return self.parser != "spreadsheet"


def union_bbox(words: Iterable[Word]) -> BBox:
    items = list(words)
    if not items:
        raise ValueError("cannot take the bbox of zero words")
    return (
        round(min(w.x0 for w in items), 2),
        round(min(w.y0 for w in items), 2),
        round(max(w.x1 for w in items), 2),
        round(max(w.y1 for w in items), 2),
    )


def group_lines(words: Sequence[Word]) -> list[Line]:
    """Chain words left to right into visual lines.

    Each word joins the line whose rightmost word is vertically closest, so text on a
    slightly rotated scan still forms one line across the full page width.
    """
    lines: list[list[Word]] = []
    for word in sorted(words, key=lambda w: (w.x0, w.cy)):
        best: list[Word] | None = None
        best_distance = float("inf")
        for candidate in lines:
            last = candidate[-1]
            if last.x1 > word.x0 + max(2.0, word.height * 0.3):
                continue
            tolerance = 0.5 * min(last.height, word.height)
            distance = abs(last.cy - word.cy)
            if distance <= tolerance and distance < best_distance:
                best, best_distance = candidate, distance
        if best is None:
            lines.append([word])
        else:
            best.append(word)
    return [Line(words) for words in sorted(lines, key=lambda ws: statistics.fmean(w.cy for w in ws))]


def split_segments(line: Line, min_gap: float | None = None) -> list[Line]:
    """Split a line into runs of words separated by wide horizontal gaps (layout columns)."""
    gap_limit = min_gap if min_gap is not None else max(12.0, line.height * 1.2)
    segments: list[list[Word]] = [[line.words[0]]]
    for previous, word in pairwise(line.words):
        if word.x0 - previous.x1 > gap_limit:
            segments.append([word])
        else:
            segments[-1].append(word)
    return [Line(words) for words in segments]
