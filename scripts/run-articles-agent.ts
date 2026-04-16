import { ToolLoopAgent, gateway } from 'ai';
import { articleTools } from '../src/agents/articles/tools';
import { ARTICLES_AGENT_INSTRUCTIONS } from '../src/agents/articles/prompts';

const agent = new ToolLoopAgent({
  model: gateway('anthropic/claude-haiku-4.5'),
  instructions: ARTICLES_AGENT_INSTRUCTIONS,
  tools: articleTools,
  onStepFinish: async ({ stepNumber, toolCalls }) => {
    const toolNames = toolCalls?.map((tc) => tc.toolName).join(', ') || 'text';
    console.log(`  [step ${stepNumber}] ${toolNames}`);
  },
});

async function main() {
  const prompt =
    process.argv[2] ||
    'Fetch the latest articles from the OSC OHL feed. Process and save any new articles you find.';

  console.log('Prompt:', prompt);
  console.log('---');

  const result = await agent.generate({ prompt });

  console.log('---');
  console.log('Agent response:', result.text);
  console.log('---');
  console.log(
    `Steps: ${result.steps.length} | Input tokens: ${result.usage.inputTokens} | Output tokens: ${result.usage.outputTokens}`,
  );
}

main().catch((err) => {
  console.error('Agent error:', err.message);
  process.exit(1);
});
