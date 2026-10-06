# Deploy to AWS

Deploying the app to your own AWS account with CDK, and keeping it running.

## 1. Configuration

Every setting can come from an environment variable – your `.env` (copy
[`.env.example`](../.env.example)) or, in CI, the pipeline's variables – or from
CDK context (`packages/infra/cdk.json` or `-c key=value`). The environment
wins. There is no dotenv library: the package scripts and the `cdk` app
command pass `--env-file-if-exists=../../.env` to Node, so every entry point
loads the same file, and real environment variables take precedence over it.

| Environment variable | CDK context | Example | Notes |
| --- | --- | --- | --- |
| `SPOTIFY_CLIENT_ID` | `spotifyClientId` | `3f1c…` | Client ID of [your Spotify app](../README.md#the-spotify-app). Not a secret. Required – synth fails without it. |
| `DOMAIN_NAME` | `domainName` | `podcasts.example.com` | Optional. Without it, the app runs on the CloudFront domain. |
| `HOSTED_ZONE_NAME` | `hostedZoneName` | `example.com` | Defaults to the parent domain of `domainName`. Must be a Route 53 hosted zone in the same account. |
| `CERTIFICATE_ARN` | `certificateArn` | `arn:aws:acm:us-east-1:…` | Only if your DNS is **not** in Route 53. The certificate must be in us-east-1. You then point a CNAME at the `DistributionDomain` output yourself. |
| `STAGE` | `stage` | `dev` | Deployment stage (default `dev`; lower-case letters, digits, `-`). Part of the stack names (`PodcastCockpit-dev`, `PodcastCockpit-dev-Certificate`) and of the secret's SSM path, so several stages can live in one account, each with its own `DOMAIN_NAME`. |
| `STACK_NAME` | `stackName` | `PodcastCockpit` | Optional name prefix of the stacks and the SSM path. |

Every resource of both stacks is tagged `app=podcast-cockpit`, `stage=<stage>` and `managed-by=cdk`. To see costs per app and stage, activate `app` and `stage` as cost allocation tags in AWS Billing.

> Earlier versions named the stacks `PodcastCockpit` and `PodcastCockpitCertificate` (without a stage). A deploy creates the new `-<stage>` stacks next to them rather than updating them, so delete the old stacks first. DynamoDB keeps a table with retained data (`PodcastCockpit-Table…`); delete it too if you don't need it.

The client secret is **not** part of this configuration; it is set after the
first deploy (step 4).

The main stack goes to `CDK_DEFAULT_REGION` (your AWS profile's region). If
none is set, it goes to `eu-central-1`. With a Route 53 domain, a small extra
stack creates the TLS certificate in `us-east-1`, which CloudFront requires.

**AWS account.** cdk and `secret:put` use the profile in `AWS_PROFILE`. Put
it in `.env` to pin this repository to one account: the package scripts start
the CDK CLI with `.env` loaded, before it resolves credentials. A shell
`AWS_PROFILE` still wins. With AWS SSO, log in first:
`aws sso login --profile <name>`. Always deploy through the package scripts,
not a bare `cdk`, which wouldn't see `.env`.

## 2. Bootstrap (once per account/region)

```bash
pnpm --filter @podcast/infra run bootstrap aws://<ACCOUNT>/eu-central-1 aws://<ACCOUNT>/us-east-1
```

## 3. Deploy

```bash
pnpm run deploy      # from the repo root: builds the frontend, then `cdk deploy --all`
```

The outputs show `Url`, `SpotifyRedirectUri` and `SpotifyClientSecretParameter`.

## 4. Set the client secret (once, after the first deploy)

The stack creates an SSM Parameter Store *SecureString* named
`/<STACK_NAME>/<STAGE>/spotify-client-secret`, e.g. `/PodcastCockpit/dev/spotify-client-secret` (the `SpotifyClientSecretParameter`
output) with a placeholder. Until you replace it, the app shows *Spotify
app missing*. Set it with:

```bash
pnpm run secret:put                    # reads SPOTIFY_CLIENT_SECRET from .env or the environment
pnpm run secret:put -- -c stage=prod   # same -c context arguments as cdk
```

The script looks up the parameter name in the stack's outputs and must run
with the same AWS profile and region you deployed to. It resolves the stack
like `cdk` does (environment, `-c` arguments, `cdk.json`) and prints the
target stack first. You can also edit the
parameter in the AWS console, or in CI run
`aws ssm put-parameter --name /PodcastCockpit/dev/spotify-client-secret --type SecureString --overwrite --value "$SPOTIFY_CLIENT_SECRET"`.
Redeploys never touch the value. Repeat this step when you rotate the secret
in the Spotify dashboard; the app picks it up within five minutes.

**Why Parameter Store.**
- A plain Lambda environment variable would put the secret into the
  CloudFormation template and the Lambda console. A SecureString is encrypted
  with KMS and only read by the Lambdas at runtime.
- Standard parameters cost nothing; Secrets Manager costs $0.40 per secret
  per month, and its main extra (automatic rotation) doesn't apply to a
  Spotify secret.
- CloudFormation can't create SecureString parameters with a value. The stack
  therefore creates the parameter with a placeholder through a small custom
  resource, so the real value never appears in a template.

## 5. Log in

1. Add the `SpotifyRedirectUri` output to the redirect URIs of [your Spotify app](../README.md#the-spotify-app), e.g. `https://podcasts.example.com/api/auth/callback`.
2. Open the `Url` and log in with Spotify. The first account that logs in becomes the owner; every other account is rejected. Only accounts listed under *User Management* of your Spotify app can log in at all, so nobody else can claim the installation first.
3. The first import runs automatically. Then confirm the guessed mode and categories under **Podcasts → Review**.

## Costs

For one user, this stays in or near the AWS free tier: Lambda, DynamoDB on-demand, API Gateway and CloudFront each cost a few cents at most; the SSM parameter is free. A Route 53 hosted zone costs $0.50 per month. Point-in-time recovery for DynamoDB is enabled, and on such a tiny table it costs fractions of a cent.

## Resetting

- **Wrong Spotify account, or locked out:** delete the item `PK=META, SK=CONFIG` from the DynamoDB table and log in again with the right account. This keeps your progress.
- **Delete everything:** go to Settings → *Delete all data*. The table itself has a `Retain` policy, so it survives `cdk destroy`.
