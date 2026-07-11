from openai import OpenAI

client = OpenAI(
  base_url="https://zenmux.ai/api/v1",
  api_key="sk-ai-v1-681ae4c0bc0fc269bc1d6d19ed0911b9bdb9907cd28cffa545e19d092cb586f4",
)

# Chat Completion
completion = client.chat.completions.create(
  model="x-ai/grok-4.5-free",
  messages=[
    {
      "role": "user",
      "content": "কেমন আছো?"
    }
  ]
)
print(completion.choices[0].message.content)

# Responses API
responses = client.responses.create(
  model="x-ai/grok-4.5-free",
  input="কেমন আছো?"
)
print(responses)