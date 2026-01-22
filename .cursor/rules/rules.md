# Lambda Router - Cursor Rules

## Project Context

- This is a zero-dependency AWS Lambda event router library
- Supports SQS, SNS, EventBridge, and DynamoDB Streams
- Designed to be lightweight and type-safe

## Tech Stack

- TypeScript with strict mode
- Bun for runtime and testing
- Biome for linting/formatting (single quotes, no semicolons)
- bunup for building

## Coding Conventions

- Use `import type` for type-only imports
- Use `.ts` extensions in imports (`from './types.ts'`)
- Prefer function overloads for flexible APIs
- Add JSDoc comments with `@example` blocks for public APIs
- Use `readonly` for immutable properties in interfaces

## Architecture Patterns

- Each event source has its own router class in `src/routers/`
- Context objects provide typed access to event data
- Handlers receive a context object (not raw events)
- First-match-wins routing strategy

## Testing Conventions

- Use Bun test (`describe`, `test`, `expect`, `mock`)
- Test fixtures go in `test/fixtures.ts`
- Test file naming: `*.test.ts`
- Test behavior, not implementation details

## Commands

- `bun run lint` / `bun run lint:fix` - Linting
- `bun test` - Run tests
- `bun run typecheck` - Type checking
- `bun run build` - Build for distribution
