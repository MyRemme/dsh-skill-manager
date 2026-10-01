# Pull request

## Submitting a skill to the registry

- [ ] I added **one** file under `registry/data/skills/`, named `<owner>__<repo>--<skill>.yml`
- [ ] `repo`, `name` and `path` describe the skill I actually wrote
- [ ] The description says what the skill does, without superlatives
- [ ] I ran `npm run registry:build` and committed the regenerated `registry/skills.json`
- [ ] The skill name does not collide with an existing entry

## Changing the plugin

- [ ] `node --test "test/**/*.test.mjs"` passes
- [ ] `node registry/scripts/build-registry.mjs --check` passes
- [ ] A change to the HTTP surface updates both `lib/index.js` (ROUTES) and
      `lib/client.js` (API); a test asserts the two stay in step

## Anything else reviewers should know

<!-- Keep it short. -->
