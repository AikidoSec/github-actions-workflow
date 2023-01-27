# Aikido Security Github action

This repository contains an application that can be used in Github action workflows. It will trigger a scan in Aikido to make sure no new critical issues are introduced into your application.

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
