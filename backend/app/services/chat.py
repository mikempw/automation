"""Chat service — LLM-powered conversational interface with skill routing."""
import json
import logging
import os
from typing import Optional

import httpx

from .executor import list_skills, get_skill, execute_skill
from .vault import get_device_credentials
from ..models import ExecutionRequest

logger = logging.getLogger(__name__)


def _build_mcp_tools_context() -> str:
    """Build context string for external MCP tools available to the agent."""
    try:
        from .integrations import get_all_mcp_tools
        tools = get_all_mcp_tools()
        if not tools:
            return ""
        lines = ["EXTERNAL MCP TOOLS (from connected MCP servers):"]
        for t in tools:
            lines.append(f"  - {t['mcp_server_name']}/{t['tool_name']}: {t['description']}")
        lines.append("  Note: To use external MCP tools, mention the tool name and the system will route the request.")
        return "\n".join(lines) + "\n"
    except Exception:
        return ""


def _build_system_prompt(skills: list, devices: list) -> str:
    """Build system prompt with skill catalog and device inventory."""
    skill_catalog = []
    for s in skills:
        full = get_skill(s.name)
        if not full:
            continue
        # Skip skills marked as hidden from chat (internal/API-only skills)
        metadata = full.get("metadata", {})
        if metadata.get("chat_hidden", False):
            continue
        params_desc = []
        for p in full.get("parameters", []):
            req = "required" if p.get("required", True) else "optional"
            params_desc.append(f"    - {p['name']} ({p.get('type','string')}, {req}): {p.get('description','')}")
        params_str = "\n".join(params_desc) if params_desc else "    (none)"

        skill_catalog.append(
            f"  SKILL: {s.name}\n"
            f"  Product: {s.product}\n"
            f"  Description: {s.description}\n"
            f"  Destructive: {full.get('safety',{}).get('destructive', False)}\n"
            f"  Requires Approval: {full.get('safety',{}).get('requires_approval', True)}\n"
            f"  Parameters:\n{params_str}\n"
        )

    device_list = []
    for d in devices:
        device_list.append(f"  - {d['hostname']} ({d['device_type']}) at {d['mgmt_ip']}")

    return f"""You are an F5 network engineering assistant integrated with the F5 Insight Skills platform.
You help engineers troubleshoot, configure, and manage F5 BIG-IP and NGINX devices.

You have access to the following skills and devices:

AVAILABLE SKILLS:
{chr(10).join(skill_catalog) if skill_catalog else '  (no skills available)'}

REGISTERED DEVICES:
{chr(10).join(device_list) if device_list else '  (no devices registered)'}

{_build_mcp_tools_context()}
INSTRUCTIONS:
- When a user describes a problem or asks to perform an action, identify the best matching skill.
- When you want to execute a skill, respond with a JSON block in this exact format:

```json
{{
  "action": "execute_skill",
  "skill_name": "the-skill-name",
  "device_hostname": "the-device-hostname",
  "parameters": {{
    "param1": "value1",
    "param2": "value2"
  }},
  "explanation": "Brief explanation of what this will do and why"
}}
```

- Fill in ALL required parameters based on context from the conversation.
- If you need more information to fill parameters, ASK the user — don't guess.
- If the user mentions a device by name or IP, match it to the registered devices.
- If there's only one device of the required type, use it automatically.
- After a skill executes, you'll receive the results. Analyze them and provide actionable guidance.
- For general questions about F5/NGINX that don't require running a skill, just answer directly.
- Be concise and technical. These are experienced network engineers.
- NEVER fabricate skill names or device names. Only use what's in the catalog above.
- If no skill matches the request, say so and suggest what might help.

CRITICAL — CONVERSATION CONTEXT:
- The conversation history includes results from previously executed skills marked as [SKILL EXECUTION RESULT].
- ALWAYS check conversation history before running a skill. If you already have the data you need from a prior execution, USE IT — do not re-run the same skill.
- For example: if you already ran bigip-vs-config and got the VIP, pool members, etc., use that data directly when filling parameters for the next skill (like tcpdump).
- When the user responds with simple acknowledgments like "great", "ok", "thanks", "cool", etc., treat them as conversation — do NOT re-run any skills or propose new actions unless the user explicitly asks for something.
- You can chain skills: run a read-only skill first to gather info, then use that info to fill parameters for a follow-up skill.

MULTI-TURN OPTIMIZATION — AVOID REDUNDANT SKILLS:
- Before proposing any skill, scan the ENTIRE conversation history for [SKILL EXECUTION RESULT] blocks.
- If you already have the data you need from a prior execution, DO NOT re-run the skill.
- Specifically: if bigip-pool-status was already run, don't run it again unless the user explicitly asks to refresh.
- If bigip-vs-config was already run for a VS, use that data for tcpdump filters, node toggle, etc.
- Only re-run a discovery skill if: (a) the user explicitly asks to refresh, (b) a destructive action was taken that may have changed state, or (c) you need data for a DIFFERENT device/VS than what's in history.
- When chaining skills, extract specific values (IPs, ports, pool names) from prior results to fill parameters.
"""


async def _call_llm(messages: list, system_prompt: str) -> str:
    """Call the configured LLM provider."""
    provider = os.getenv("LLM_PROVIDER", "anthropic").lower()

    if provider == "anthropic":
        return await _call_anthropic(messages, system_prompt)
    elif provider == "openai":
        return await _call_openai(messages, system_prompt)
    elif provider == "local":
        return await _call_local(messages, system_prompt)
    else:
        return f"Unknown LLM_PROVIDER: {provider}"


async def _call_anthropic(messages: list, system_prompt: str) -> str:
    api_key = os.getenv("ANTHROPIC_API_KEY", "")
    if not api_key:
        return "Anthropic API key not configured. Set ANTHROPIC_API_KEY in .env."
    model = os.getenv("ANTHROPIC_MODEL", "claude-sonnet-4-20250514")
    try:
        import anthropic
        client = anthropic.Anthropic(api_key=api_key)
        response = client.messages.create(
            model=model,
            max_tokens=4000,
            system=system_prompt,
            messages=messages,
        )
        return response.content[0].text
    except Exception as e:
        logger.error(f"Anthropic chat error: {e}")
        return f"LLM error: {str(e)}"


async def _call_openai(messages: list, system_prompt: str) -> str:
    api_key = os.getenv("OPENAI_API_KEY", "")
    if not api_key:
        return "OpenAI API key not configured. Set OPENAI_API_KEY in .env."
    model = os.getenv("OPENAI_MODEL", "gpt-4o")
    base_url = os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1")
    oai_messages = [{"role": "system", "content": system_prompt}] + messages
    try:
        async with httpx.AsyncClient() as client:
            r = await client.post(
                f"{base_url}/chat/completions",
                headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                json={"model": model, "max_tokens": 4000, "messages": oai_messages},
                timeout=120,
            )
            if r.status_code != 200:
                return f"OpenAI error {r.status_code}: {r.text[:200]}"
            return r.json()["choices"][0]["message"]["content"]
    except Exception as e:
        logger.error(f"OpenAI chat error: {e}")
        return f"LLM error: {str(e)}"


async def _call_local(messages: list, system_prompt: str) -> str:
    base_url = os.getenv("LOCAL_LLM_BASE_URL", "http://host.docker.internal:11434/v1")
    model = os.getenv("LOCAL_LLM_MODEL", "gpt-oss:20b")
    api_key = os.getenv("LOCAL_LLM_API_KEY", "not-needed")
    oai_messages = [{"role": "system", "content": system_prompt}] + messages
    try:
        async with httpx.AsyncClient() as client:
            r = await client.post(
                f"{base_url}/chat/completions",
                headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                json={"model": model, "max_tokens": 4000, "messages": oai_messages},
                timeout=300,
            )
            if r.status_code != 200:
                return f"Local LLM error {r.status_code}: {r.text[:200]}"
            return r.json()["choices"][0]["message"]["content"]
    except Exception as e:
        logger.error(f"Local LLM chat error: {e}")
        return f"LLM error: {str(e)}"


def _extract_skill_request(text: str) -> Optional[dict]:
    """Extract a skill execution request from LLM response if present."""
    import re
    # Look for ```json ... ``` blocks
    match = re.search(r'```json\s*\n?(.*?)```', text, re.DOTALL)
    if not match:
        # Try bare JSON with action field
        match = re.search(r'\{[^{}]*"action"\s*:\s*"execute_skill"[^{}]*\}', text, re.DOTALL)
        if match:
            try:
                return json.loads(match.group(0))
            except json.JSONDecodeError:
                return None
        return None
    try:
        data = json.loads(match.group(1))
        if isinstance(data, dict) and data.get("action") == "execute_skill":
            return data
    except json.JSONDecodeError:
        pass
    return None


async def process_chat(messages: list, devices: list) -> dict:
    """Process a chat message through the LLM agent.
    
    Returns:
        {
            "response": "LLM text response",
            "skill_request": null or {skill_name, device_hostname, parameters, explanation},
            "execution_result": null or ExecutionResult (if auto-executed after approval)
        }
    """
    # Build skill catalog
    skills = list_skills()
    system_prompt = _build_system_prompt(skills, devices)

    # Call LLM
    response_text = await _call_llm(messages, system_prompt)

    # Check if LLM wants to execute a skill
    skill_request = _extract_skill_request(response_text)

    # Clean the response text — remove the JSON block for display
    display_text = response_text
    if skill_request:
        import re
        display_text = re.sub(r'```json\s*\n?.*?```', '', response_text, flags=re.DOTALL).strip()
        if not display_text:
            display_text = skill_request.get("explanation", "I'd like to run a skill.")

    return {
        "response": display_text,
        "skill_request": skill_request,
        "execution_result": None,
    }


async def execute_approved_skill(skill_request: dict) -> dict:
    """Execute a skill that was approved by the user."""
    try:
        req = ExecutionRequest(
            skill_name=skill_request["skill_name"],
            device_hostname=skill_request["device_hostname"],
            parameters=skill_request.get("parameters", {}),
        )
        result = await execute_skill(req)
        return result.model_dump()
    except Exception as e:
        logger.error(f"Skill execution from chat failed: {e}")
        return {"status": "failed", "error": str(e)}
