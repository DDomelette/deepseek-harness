# Explaining the harness

English | [中文](explaining-the-harness.zh.md)

This page records how the [pages in this folder](README.md) explain DeepSeek Harness, and what the first version of the turn and step walkthrough got wrong. Read it before rewriting that walkthrough or adding a mechanism diagram beside it.

## What the first walkthrough got wrong

The first walkthrough traced the loop in the order the code runs. That order is accurate and, on its own, teaches nothing about why the loop is shaped this way. Four faults produced that result.

- **The ordering axis was control flow rather than causality.** `system-prompt/assemble` appeared before `agent/pre-step` because the driver calls them in that order. A reader could not see why the first has to precede the second, so the sequence read as arbitrary.
- **Terms stood in for explanations.** A frame said listeners may rewrite or reject a claimed message. That states what a hook can do; it never says why the loop needs a checkpoint at that point at all.
- **Frames carried no connective tissue.** Each frame had an arrow between two actors and a description of its own action, but no sentence of the form "the previous frame produced X, so this frame can now do Y". Neighbouring frames never referred to each other.
- **Three viewpoints shared one surface.** A frame could be answering any of three different questions — what the user wants, where the state machine stands, or whether an event survives a restart — with nothing telling the reader which one.

The reader therefore saw a list of independent actions instead of one line of reasoning, and retained vocabulary without retaining causality.

## The model that replaces it

Every mechanism in the walkthrough is a **prerequisite of the user's goal**, and **satisfying one prerequisite creates the next**.

That sentence carries the explanations the control-flow trace leaves out. It says why a turn opens (nothing else marks the point at which the task is finished), why the prompt is assembled on every step rather than once at startup (each step renders its own request), and above all why a turn with two steps has a second step: step one answered "how many lines are there", and that answer created the next prerequisite, "now write it into LOC.md".

The prerequisite chain also places the parts a newcomer finds unrelated. The driver, the rendered prompt, and the tool schemas are not a startup ritual that finishes before work begins; they are prerequisites that every step satisfies again.

## Writing rules

- **Order by prerequisite, not by execution order.** Where the two disagree, causality wins and execution order becomes a detail inside the frame.
- **State the problem before the name.** Open with what is being decided or produced here; attach the identifier afterwards as a label. Identifiers are the names of solutions, not explanations of problems.
- **Connect each frame to the one before it.** Name what the previous frame produced and why that makes this frame possible now.
- **Say what leaves the frame.** State the fact or artefact the next frame depends on, so the chain is visibly load-bearing rather than decorative.
- **Mark the zone.** A reader should always know whether the current frame is preparing the model to work, doing the user's work, or making the result replayable.

## Worked example

The `agent/pre-step` frame, rewritten from a capability statement into a link in the chain. The old version stated what the hook can do, leaving the reader unable to say why the loop needs it there.

> `agent/pre-step` · waterfall · listeners may rewrite or reject the claimed messages. Injection and steering also pass through here; the returned decision is authoritative.

The rewrite answers the five questions that turn an isolated frame into a link.

| Line | What it establishes |
|---|---|
| Needs to answer | May this message enter the step, and who is the last party able to stop it? |
| Because | The previous frame took the message out of the queue, and taking it out is not the same as sending it. A compaction plugin may find the context nearly full and want to summarize first. |
| So | The loop opens a checkpoint where every plugin may inspect, rewrite, or veto the batch. |
| Leaves behind | The message batch this step will actually carry, which is what lets the step open. |
| Name | `agent/pre-step` waterfall, whose returned decision is authoritative. |
