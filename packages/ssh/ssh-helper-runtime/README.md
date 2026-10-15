---
description: "Build and verify SSH helper executables with an embedded Node runtime for Linux and macOS."
kind: "package-library"
---

# @deepseek-ai/dsh-ssh-helper-runtime

English | [中文](README.zh.md)

## Summary

Run the SSH helper on a remote machine without installing Node or npm packages. Each archive includes the executable, its native resources and integrity metadata. The private carrier supports managed processes, terminals, sandboxing and an embedded PTC worker through the existing SSH providers. Project commands still use the remote machine’s own development tools.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

### Build and installation

This private workspace carries the helper executable's sources and its spawn-helper native dependency; it is not a profile plugin or an npm CLI. The archive builder, its verifiers, and the release workflows belong to the packaging lane this tree does not carry, so the helper is built where that lane lives.


The packaging lane's builder requires Node 24, a C/C++ compiler, and the development headers from that Node installation. Linux additionally needs `musl-gcc`, and its node-pty addon must meet the glibc baseline: the lane's native workflow prepares that compatible addon before packaging. It accepts one native target, reuses prepared JS/native outputs, and validates target and dependency declarations without building.

| Target | Native archive | Checked deployment baseline |
|---|---|---|
| `node24-linux-x64` | `linux-x64` | glibc 2.28 |
| `node24-linux-arm64` | `linux-arm64` | glibc 2.28 |
| `node24-macos-x64` | `macos-x64` | macOS 14 deployment target |
| `node24-macos-arm64` | `macos-arm64` | macOS 14 deployment target |

A built archive must contain `dsh-ssh-helper`, `native/system/`, licenses, and `manifest.json`; macOS also includes `dsh-ssh-helper-spawn-helper`. The manifest pins the source commit, whether the source tree was dirty, the embedded Node version, the protocol, and every payload file's digest and permissions.

Verify the archive checksum, then extract the whole directory into a versioned runtime location outside the project and replaced temporary mounts. Keep the native resources beside the executable. The installation can be read-only; the helper user needs a writable temporary/cache location. Configure [`dsh-ssh`](../ssh/README.md) with `launch: { kind: "executable" }`, the absolute `helper` path and the executable’s SHA-256 from the manifest. The client obtains the embedded PTC invocation through `ctx.ssh.ptcLaunch`.

### Verification and publication

The packaging lane's artifact verifier validates and relocates an archive, makes installation files read-only, and runs two concurrent Loader compositions sharing a fresh native cache. Those compositions exercise files, processes, PTY, native flock, and PTC through the SSH providers; macOS additionally runs a worker under a policy denying the checkout and the host Node.

The packaging lane's OpenSSH verifier accepts a Linux archive, creates a temporary glibc 2.28 SSH server with no Node installation, mounts only the release and a disposable public key, and exercises the production connection. Its portability lane makes no kernel-confinement claim; the native host lane owns that check.

Ordinary pull-request and master CI run source and build-script checks without building SSH executables; helper startup, native-dependency, and packaging changes additionally need that lane's manual native workflow before merging. Deployment-target inspection alone does not establish execution on the oldest macOS version.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The carrier embeds its closed dependency set with the repository’s patched `pkg --sea` pipeline. Its entry dispatches the SSH helper, managed subprocess runner or PTC worker. Shared deployment helpers in that lane also serve the Python SDK builder. Production deploy restores development installation state before invoking build tools, so pnpm’s automatic dependency check cannot prune them.

The operating system must execute the Landlock and PTY launchers from real files. A process-local resolution hook points the system package at its co-shipped native directory; node-pty uses its existing executable-relative spawn-helper convention. Binary inspection covers the embedded native modules before packaging and the external resources before publication.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [SSH connection](../ssh/README.md) — authentication, invocation and lifecycle.
- [PTC Node runtime](../../ptc-runtime/ptc-runtime-node/README.md) — explicit worker launch and execution limits.
- [SSH subsystem](../../../docs/subsystems/ssh.md) — remote execution coordinates.

-----

<a id="model-experience"></a>
## Model Experience

None, as this private process carrier registers no model-facing tools or prompt content; its consumers own operation results.

#### KV Cache effect

The carrier adds no request-prefix content.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Windows and musl-based Linux are not build targets. Sandbox availability still depends on the target kernel and system tools.
- Automatic download, deployment, updates and connection UI are separate from archive production.
- The executable accepts private worker invocations, not arbitrary Node CLI arguments. Project `node` commands and nested JavaScript subprocesses need their own Node installation.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. This private carrier only builds the helper executable the connection owner launches; `dsh-ssh` owns the helper identity, launch arguments, and stream security.