// Negative type fixture: node:ffi is a Node 26-only API.
// If @types/node ever drifts to 26+, this import would resolve and
// the @ts-expect-error would become unused, triggering TS2578 and
// failing the typecheck gate.
// @ts-expect-error — node:ffi does not exist in @types/node@22
import { open } from 'node:ffi'

// This line must never execute; it exists only to satisfy the import.
void open
