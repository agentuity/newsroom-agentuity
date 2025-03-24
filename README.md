<div align="center">
    <img src=".github/Agentuity.png" alt="Agentuity" width="100"/> <br/>
    <strong>Newsroom: AI-Powered Content Pipeline</strong> <br/>
    <strong>Build Agents, Not Infrastructure</strong> <br/>
<br />
<a href="https://github.com/agentuity/newsroom-agentuity"><img alt="GitHub Repo" src="https://img.shields.io/badge/GitHub-Newsroom-blue"></a>
<a href="https://github.com/agentuity/newsroom-agentuity/blob/main/LICENSE.md"><img alt="License" src="https://badgen.now.sh/badge/license/Apache-2.0"></a>
<a href="https://discord.gg/vtn3hgUfuc"><img alt="Join the community on Discord" src="https://img.shields.io/discord/1332974865371758646.svg?style=flat"></a>
</div>
</div>

# Newsroom: AI-Powered Content Pipeline

> [!WARNING]  
> This repository is under heavy development and it is not yet stable or ready for use.

Newsroom is an automated content generation system that collects, processes, and publishes AI-related news content. It leverages a suite of specialized AI agents to handle different aspects of the content pipeline, from research and filtering to editing and podcast generation. The system enables users to stay informed about AI developments without manual content curation, offering both text-based articles and podcast versions of the content.

## Documentation

For comprehensive documentation on Agentuity, visit our documentation site at [agentuity.dev](https://agentuity.dev).

## Features

- **EditorInChief**: Orchestrates the entire content workflow
- **Investigator**: Gathers news articles from web sources using Firecrawl
- **Filter**: Evaluates articles for relevance to AI topics and filters duplicates
- **Editor**: Enhances content with additional context and improved structure
- **PodcastEditor**: Creates podcast transcripts from the edited articles
- **PodcastVoice**: Generates audio versions of the podcast transcripts

## Installation

This agent is built using the Agentuity SDK.

```bash
# Install dependencies
bun install
```

## Usage

```bash
# Run the agent locally
agentuity dev
```

## Deployment

```bash
# Deploy with Agentuity
agentuity deploy
```

## Contributing

Contributions are welcome! If you have an example you'd like to add, please submit a pull request.

## License

See the [LICENSE](LICENSE.md) file for details.
