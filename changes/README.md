# Unreleased changes

Each pull request that changes behaviour adds its own file here, named after its branch (e.g.
`fix-question-answer-newlines.md`). The file holds the CHANGELOG bullet exactly as it should appear:

```md
- Fix long questions from Claude being cut off after two lines in the chat.
```

One file per change means two open PRs never edit the same lines. The release PR runs `npm run changelog -- X.Y.Z`,
which moves every entry into a new `## X.Y.Z` section of `CHANGELOG.md` and deletes the files.
