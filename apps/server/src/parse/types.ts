import type { Api } from '@app/core';

/** Hard input limits (enforced by the route; the parser also clamps defensively). */
export const MAX_TEXT_CHARS = 500;
export const MAX_ITEMS = 12;
export const MAX_QTY = 10_000;

/*
 * The parser's output types are the API contract, defined ONCE in packages/core/src/api/dto.ts
 * (ParsedItem / ParseNote / ParseResponse). They are aliased here so the parser modules keep their names.
 * A ParsedItem is structurally an engine Requirement plus metadata, and a valid Api.RequirementInput:
 * /api/resolve, /api/plan and /api/options accept it verbatim.
 */
export type NoteCode = Api.ParseNoteCode;
export type ParseNote = Api.ParseNote;
export type CategoryCandidate = Api.CategoryCandidate;
export type InheritedAttr = Api.InheritedAttr;
/**
 * `qtyExact`: the exact length in metres when the user wrote a fractional one («یک و نیم متر» -> 1.5, «نیم متر» ->
 * 0.5). `qty` is an integer (the API contract) and holds that length rounded up, `unit` is «متر». Absent otherwise.
 */
export type ParsedItem = Api.ParsedItem & { qtyExact?: number };
export type ParsePreference = Api.ParsePreference;
/** The parse response without the route-level `degraded` flag. */
export type ParseResult = Omit<Api.ParseResponse, 'degraded'>;
