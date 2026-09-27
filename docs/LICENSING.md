# Licensing decision

BIP-AI is licensed under the **Apache License, Version 2.0**.

The project uses the SPDX identifier `Apache-2.0`, the canonical license text is stored in the repository root as `LICENSE`, and project attribution information is stored in `NOTICE`.

## Why Apache-2.0

Apache-2.0 is a permissive open-source license. It allows use, modification, distribution, and commercial adoption without requiring downstream applications to publish their own source code.

It was selected for BIP-AI because it combines permissive adoption with explicit contributor patent licensing and patent-termination terms. That is a useful fit for an extensible agent/infrastructure project that may receive outside contributions or be embedded in commercial systems.

## Practical implications

Downstream users may build proprietary products or hosted services using BIP-AI, provided they comply with Apache-2.0's redistribution and notice requirements.

Modified files distributed to others must carry prominent notices that they were changed, and applicable copyright, patent, trademark, attribution, license, and NOTICE information must be preserved as required by the license.

The Apache license does not grant rights to project or third-party trademarks beyond normal descriptive use.

## Package publication

The repository package metadata identifies `Apache-2.0`, but `private: true` remains enabled intentionally. Selecting the open-source license does not automatically mean BIP-AI should be published to npm or another registry. Registry publication remains a separate release decision.

## Future dependencies

Any future runtime or development dependency must be reviewed for license compatibility before it becomes part of a public release. See [Dependency policy](./DEPENDENCY-POLICY.md).
