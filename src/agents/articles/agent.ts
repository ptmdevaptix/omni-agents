import { ToolLoopAgent, gateway } from 'ai';
import { articleTools } from './tools';
import { ARTICLES_AGENT_INSTRUCTIONS } from './prompts';

export const articlesAgent = new ToolLoopAgent({
  model: gateway('anthropic/claude-haiku-4.5'),
  instructions: ARTICLES_AGENT_INSTRUCTIONS,
  tools: {
    ...articleTools,
    // MCP tools will be spread here at runtime
  },
});
