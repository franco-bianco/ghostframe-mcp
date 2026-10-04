# Documentation guidelines

Use these rules for new and revised Ghostframe documentation.
Write Markdown. Keep examples close to the steps that use them.

These rules use selected ideas from ASD-STE100 Simplified Technical English.
They do not require its approved dictionary or claim compliance with the specification.
Use clear technical terms when a simpler word would change the meaning.

## Write clear sentences

- Use active voice. Name the component that performs the action.
- Use the command form for steps: “Call `start_capture`.”
- Put one action in each instruction sentence.
- Aim for 20 words or fewer in instructions and 25 words or fewer in descriptions.
- Split long sentences when each part expresses a separate idea.
- Use the same term for the same component throughout the document.
- Define a technical term when the reader first needs it.
- Avoid long chains of nouns, vague claims, and promotional language.
- Keep each paragraph on one topic. Aim for six sentences or fewer.

Use simple present for behavior, simple past for completed results, and simple future for expected results.
Use passive voice only when the actor is unknown or does not help the reader.
Keep exact identifiers, commands, protocol names, and errors unchanged.

## Organize around the reader's task

Start with the purpose and the result the reader can obtain.
State the requirements before the procedure.
Use a numbered list for steps that must occur in order.
Put one main action in each step.
Place the expected result after the action that produces it.

Use headings to separate installation, procedures, reference material, and limits.
Use a table when readers must compare capabilities or map names to behavior.
Link to existing explanations instead of copying them into several documents.
Keep generated tool and option references under their existing generation markers.

## Explain scope and limits

Describe the behavior that the implementation supports.
Distinguish browser evidence from conclusions that an agent derives from it.
State defaults, opt-in behavior, deadlines, resource limits, and cleanup behavior where they affect the task.
Describe partial capture and missing data explicitly.
Do not claim complete target coverage, exact wire bytes, or guaranteed stealth without evidence.

Show the action that resolves a common failure.
For software limits, use a plain description of the condition and its effect.
Do not copy aerospace safety labels into ordinary software instructions.

## Use diagrams when they reduce reading

Use a small Mermaid diagram for a flow, lifecycle, or ownership relationship.
Give each node a short label. Use arrows for a defined transition or dependency.
Add a text explanation so the document remains useful without diagram rendering.
Do not add a diagram for a single fact or a short sequence that is already clear.

## Check documentation changes

1. Check each command and tool name against the implementation.
2. Check examples against the current input schema.
3. Remove repeated explanations and unsupported claims.
4. Regenerate tool and CLI references when a schema changes.
5. Run `npm run format`.
6. Run `npm run check-format`.

For implementation changes, also run `npm run test` as required by `AGENTS.md`.
