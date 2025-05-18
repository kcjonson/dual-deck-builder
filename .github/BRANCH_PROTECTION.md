# Branch Protection Rules

This file provides instructions on how to set up branch protection rules for this repository to block PRs from merging if tests or linting fail.

## Steps to Configure Branch Protection (must be done by a repository admin)

1. Go to the repository on GitHub.
2. Click on "Settings" tab.
3. In the left sidebar, click on "Branches".
4. Under "Branch protection rules", click on "Add rule".
5. In the "Branch name pattern" field, enter `master` (or `main` if that's your default branch).
6. Check the following options:
   - [x] Require a pull request before merging
   - [x] Require status checks to pass before merging
   - [x] Require branches to be up to date before merging
7. In the "Status checks that are required" search box, search for and select:
   - CI / Test and Lint
   - Web Build / build-web
   - Electron Build / build-windows
   - Electron Build / build-macos
8. Click "Create" or "Save changes".

These settings ensure that:

- All PRs must pass tests and linting before they can be merged
- The code must successfully build for both web and desktop platforms
- The PR must be up to date with the target branch before merging

## Additional CI/CD Settings

The CI/CD workflow now includes:

- Automated testing with Jest
- Code linting
- Test coverage reporting
- Build verification for Web and Electron targets

All of these checks must pass for a PR to be eligible for merging.
