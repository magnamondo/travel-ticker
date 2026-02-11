You are able to use the Svelte MCP server, where you have access to comprehensive Svelte 5 and SvelteKit documentation. Here's how to use the available tools effectively:

## Available MCP Tools:

### 1. list-sections

Use this FIRST to discover all available documentation sections. Returns a structured list with titles, use_cases, and paths.
When asked about Svelte or SvelteKit topics, ALWAYS use this tool at the start of the chat to find relevant sections.

### 2. get-documentation

Retrieves full documentation content for specific sections. Accepts single or multiple sections.
After calling the list-sections tool, you MUST analyze the returned documentation sections (especially the use_cases field) and then use the get-documentation tool to fetch ALL documentation sections that are relevant for the user's task.

### 3. svelte-autofixer

Analyzes Svelte code and returns issues and suggestions.
You MUST use this tool whenever writing Svelte code before sending it to the user. Keep calling it until no issues or suggestions are returned.

### 4. playground-link

Generates a Svelte Playground link with the provided code.
After completing the code, ask the user if they want a playground link. Only call this tool after user confirmation and NEVER if code was written to files in their project.

## Implementation Guidelines

When asked to build "robust", "battle-proof", or "production-ready" features, don't just implement the happy path. Think through failure modes upfront and implement patterns to handle them. This includes:
- Validating inputs and API responses
- Implementing retries with backoff for transient failures
- Providing clear error messages and recovery options for users
- Logging errors for monitoring and debugging
### General robustness patterns:
- Verify API assumptions. Don't assume APIs will always return expected data or succeed.
- Think about what happens when: network drops, user closes tab, server times out, partial success
- Consider UX during failures: what does the user see? can they recover?
- Test your mental model before writing code - trace the data flow
- Ask about specific failure scenarios if requirements are vague

## SvelteKit Navigation

**Use `resolve()` from `$app/paths` for internal links.** When linking between pages, use:
```svelte
<script>
  import { resolve } from '$app/paths';
</script>

<a href={resolve(`/entry/${id}`)}>Link</a>
```
Not:
```svelte
<a href="/entry/{id}">Link</a>
```

The `resolve()` function ensures proper client-side navigation that correctly re-runs load functions and respects the base path. Without it, navigation may serve stale cached data or fail to trigger load function re-runs.

