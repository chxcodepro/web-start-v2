# Agent Note: Native Vercel Git deployments

Status: implemented

## Problem

The existing Vercel project is locally linked but has no Git repository connection. Pushing fixes to GitHub therefore leaves production unchanged until a separate CLI deployment.

## Decision

The existing `start-web` Vercel project connects to `chxcodepro/web-start-v2` through the native GitHub integration. Its production branch is `main`, and Git-provider deployment creation is enabled. Successful builds from pushes to `main` update `https://start.chxpro.com`; other branches use Preview deployments.

The project, domains, production environment variables, Singapore function region, and scheduled GitHub sync remain unchanged. No parallel GitHub Actions deployment workflow is introduced, and no Vercel or database credentials are added to the repository.

CLI production deployments remain an explicit emergency option rather than the normal release workflow. A push must not also trigger a separate CLI production deployment.

## Alternatives considered

- A GitHub Actions workflow provides custom test gates and controlled build stages, but it requires additional deployment credentials and duplicates the native integration for this single-project repository.
- Manual CLI deployment provides direct release control without Git-provider permissions, but it leaves the requested push-to-deploy workflow dependent on a separate operator action.

## Consequences

- Main-branch pushes become production release events. Contributors must run relevant checks before pushing; the Vercel build does not replace the full test suite.
- Non-production branches gain Preview deployments and can consume additional build resources.
- GitHub integration access and the Vercel connection must stay enabled. API checks of the repository link, production branch, and deployment source distinguish configuration failures from application build failures.

## Verification

The Vercel project API reports the GitHub repository link, `productionBranch: main`, and `gitProviderOptions.createDeployments: enabled`.

The README and this note provide a documentation-only push for end-to-end validation without changing runtime behavior. The corresponding deployment must identify the pushed GitHub commit, have `source: git`, target production, reach READY, and retain the existing production domain. No CLI deployment is used for this validation.

## Note audit

The active background-recovery and GitHub release-download notes concern application behavior, not deployment triggers. They are unrelated and remain unchanged.
