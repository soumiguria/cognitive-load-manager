import openai
import inspect

print('openai', openai.__version__)
print('OpenAI class attrs', [m for m in dir(openai.OpenAI) if not m.startswith('_')])
print('has responses', hasattr(openai.OpenAI, 'responses'))
print('has chat', hasattr(openai.OpenAI, 'chat'))
if hasattr(openai.OpenAI, 'responses'):
    print('responses object', openai.OpenAI.responses)
if hasattr(openai.OpenAI, 'chat'):
    print('chat object', openai.OpenAI.chat)
try:
    print('responses.create sig', inspect.signature(openai.OpenAI.responses.create))
except Exception as e:
    print('responses signature error', repr(e))
try:
    print('chat.completions.create sig', inspect.signature(openai.OpenAI.chat.completions.create))
except Exception as e:
    print('chat signature error', repr(e))
