# Aikido Security Github action

This repository contains an application that can be used in Github action workflows. It will trigger a scan in Aikido to make sure no new critical issues are introduced into your application.

## Using the action

Add the following snippet to your Github action workflow file: 

```yaml
 - name: Detect new vulnerabilities
    uses: AikidoSec/github-actions-worfkflow
    with:
        secret-key: ${{ secrets.AIKIDO_SECRET_KEY }}
        max-timeout: 180
```

The action has 3 possible outcomes: 
- 'SUCCEEDED': the scan was completed successfully and we did not encounter any new critical issues
- 'FAILED': the scan was completed successfully, but we found new critical issues
- 'TIMED_OUT': the scan did not complete before the set timeout. In this case we won't let the action fail, but we do return this special case to not block your pipeline.

## Contributing

Install the dependencies  
```bash
$ npm install
```

When the changes have been implemented, you need to build and package the code for release. Run the following commands and commit it to the repository.
```bash
$ npm run build && npm run package
```

## Change action.yml

The action.yml defines the inputs and output of our action.

See the [documentation](https://help.github.com/en/articles/metadata-syntax-for-github-actions)
