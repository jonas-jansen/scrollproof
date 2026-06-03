/**
 * ============================================================================
 *  ScrollProof — Scene Types (v1)
 * ============================================================================
 *
 *  WHAT THIS FILE IS
 *  -----------------
 *  These TypeScript types ARE the v1 JSON contract. A valid ScrollProof scene
 *  is exactly a value of type `Scene` (bottom of this file). The authoring
 *  library (Python/Julia) emits JSON in this shape; the engine reads JSON in
 *  this shape. This file is the single, machine-checked definition of that
 *  shape — the prose version lives in `scrollproof-spec-v1.md`.
 *
 *  HOW TO READ IT
 *  --------------
 *  Bottom-up in dependency order: Point → BezierSegment → Path → the three
 *  object kinds → Step → the timeline types → Scene (the capstone that holds
 *  everything). Each type rests on the ones above it.
 *
 *  WHAT TYPES DO AND DON'T GUARANTEE  (important mental model)
 *  ----------------------------------------------------------
 *  Types guarantee SHAPE: "this field is a number", "this is exactly four
 *  points", "this is one of these four strings". They CANNOT guarantee
 *  RELATIONSHIPS between values — e.g. "pathB has the same segment count as
 *  path", "every {obj:id} token refers to a real object", "members are objects
 *  not groups", "at is between 0 and 1". Those are checked by a separate
 *  VALIDATION step (a function), and BEHAVIOR (how a value is used — e.g. group
 *  opacity multiplying with member opacity, ease attaching to the incoming
 *  segment) lives in the engine modules, NOT here. Each such boundary is noted
 *  in the comments with "NOT enforced here:".
 *
 *  No logic lives in this file. Types only.
 * ============================================================================
 */
export {};
