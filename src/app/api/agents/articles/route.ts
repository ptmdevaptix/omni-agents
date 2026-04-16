import { createAgentUIStreamResponse } from 'ai';
import { articlesAgent } from '@/agents/articles/agent';

export async function POST(request: Request) {
  const { messages } = await request.json();

  return createAgentUIStreamResponse({
    agent: articlesAgent,
    uiMessages: messages,
  });
}
