2026-03-20 16:00:25 ERROR    discord.app_commands.tree Ignoring exception in command 'char_view'
Traceback (most recent call last):
  File "/root/venv/lib/python3.12/site-packages/discord/app_commands/commands.py", line 859, in _do_call
    return await self._callback(interaction, **params)  # type: ignore
           ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "/root/pissmanProject/DiscordBot/AraBot.py", line 797, in char_view
    await interaction.response.send_message(embed=emb, file=avatar_file)
  File "/root/venv/lib/python3.12/site-packages/discord/interactions.py", line 1069, in send_message
    params = interaction_message_response_params(
             ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "/root/venv/lib/python3.12/site-packages/discord/webhook/async_.py", line 632, in interaction_message_response_params
    attachments_payload.append(attachment.to_dict())
                               ^^^^^^^^^^^^^^^^^^
AttributeError: 'NoneType' object has no attribute 'to_dict'

The above exception was the direct cause of the following exception:

Traceback (most recent call last):
  File "/root/venv/lib/python3.12/site-packages/discord/app_commands/tree.py", line 1302, in _call
    await command._invoke_with_namespace(interaction, namespace)
  File "/root/venv/lib/python3.12/site-packages/discord/app_commands/commands.py", line 884, in _invoke_with_namespace
    return await self._do_call(interaction, transformed_values)
           ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "/root/venv/lib/python3.12/site-packages/discord/app_commands/commands.py", line 877, in _do_call
    raise CommandInvokeError(self, e) from e
discord.app_commands.errors.CommandInvokeError: Command 'char_view' raised an exception: AttributeError: 'NoneType' object has no attribute 'to_dict'
