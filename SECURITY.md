# Security

Report vulnerabilities privately through this repository's GitHub Security tab
(“Report a vulnerability”), when private vulnerability reporting is enabled.
If that option is unavailable, ask for a private reporting channel in an issue
without including exploit details, credentials or personal information.
The repository administrator must enable private vulnerability reporting before release.

The interface and notifications support English and German.

## Dependency worker isolation

The worker runs as root inside a dedicated container and holds `DATABASE_URL` and
`CREDENTIAL_ENCRYPTION_KEY`. Integration tokens are encrypted in the database with
AES-256-GCM, using that key and owner-specific authenticated context. Encryption
at rest does not protect against a compromised worker or stolen encryption key.

Repository code (npm lifecycle scripts, builds and tests) runs under a numeric
build UID assigned per job. Claude runs under a different UID for the job, with
its own private home. The worker passes a reduced environment. The root worker's
`/proc/1/environ` is inaccessible to those UIDs on the intended Linux deployment.
The Claude subprocess necessarily receives its own Claude credential.

The Git directory is outside the worktree, owned by root and mode `0700`.
Git runs as root with a separate global configuration, hooks disabled,
filesystem monitoring disabled, and local file transport disabled. The GitHub
askpass helper lives in that protected Git directory. Job parent directories
are traversable but not listable (`0711`), while npm and Claude homes use `0700`.
The worker terminates processes under the build UID after npm steps and under
the Claude UID after analysis.

Analysis is requested explicitly. Preparing an update and publishing it are
separate approval gates. Preparation resets the worktree to the selected base,
updates the lockfile with lifecycle scripts disabled, then installs dependencies
and runs the repository's checks. The worker checks the permitted changes and
compares the diff hash before and after validation. Publishing commits and pushes
the reviewed update after the second approval. These checks are useful gates,
but cannot make arbitrary repository code safe.

## Trust boundary and limitations

UID separation is process and filesystem isolation inside one container, not a
per-job container, VM or kernel boundary. Build processes retain network access
and can reach services allowed by the container's network, including the database
network. Do not run hostile repositories or treat the worker as a multi-tenant
execution service. Resource exhaustion and kernel/container escapes are outside
this isolation model. The deployment does not enforce per-job CPU, memory or
network quotas.

Claude has a credential in its own environment and reads untrusted repository
content and remote sources. Tool restrictions and approval gates do not eliminate
prompt injection or disclosure through allowed network tools. The Git directory
is protected, but Git still consumes files from the build-owned worktree; this
is not a complete security audit of every filesystem or Git interaction.

Deploy behind HTTPS with a strong `AUTH_SECRET`, protect the database, keep
credentials narrowly scoped, and back up the encryption key securely. Give the
worker only its dedicated volume. Never mount a Docker socket or privileged host
paths. Keep the image and host patched. Independently review update diffs and
validation output before approving publication.
