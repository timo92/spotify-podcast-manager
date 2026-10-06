# D11 — AWS CDK in TypeScript

**Decision.** All infrastructure in one CDK app (requirement). The TLS
certificate lives in a small us-east-1 stack because CloudFront only accepts
certificates from there. Lambdas run on Node.js 22, arm64, bundled as ESM by
esbuild, with the AWS SDK taken from the runtime.

**Why.** Same language as the app; constructs such as `NodejsFunction` and
`BucketDeployment` remove most boilerplate. arm64 is cheaper per GB-second.
