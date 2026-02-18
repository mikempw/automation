"""LLM analysis — multi-provider support for skill execution analysis.

Extracted from executor.py. Supports Anthropic, OpenAI, and local
(Ollama/vLLM/llama.cpp) providers via LLM_PROVIDER env var.
"""
import json
import logging
import os

import httpx

logger = logging.getLogger(__name__)


async def run_analysis(output: str, params: dict, analysis_config: dict) -> str | None:
    """Run LLM analysis on the execution output.

    Supports three providers via LLM_PROVIDER env var:
      - anthropic (default): Uses Anthropic API with ANTHROPIC_API_KEY
      - openai: Uses OpenAI API with OPENAI_API_KEY
      - local: Uses any OpenAI-compatible endpoint (Ollama, vLLM, llama.cpp, etc.)
              Configure with LOCAL_LLM_BASE_URL and LOCAL_LLM_MODEL
    """
    provider = os.getenv("LLM_PROVIDER", "anthropic").lower()

    prompt_template = analysis_config.get("prompt_template", "")
    skill_model = analysis_config.get("model", "")

    # Resolve template
    prompt = prompt_template.replace("{{output}}", output[:15000])
    prompt = prompt.replace("{{params}}", json.dumps(params, indent=2))

    try:
        if provider == "anthropic":
            return await _analysis_anthropic(prompt, skill_model)
        elif provider == "openai":
            return await _analysis_openai(prompt, skill_model)
        elif provider == "local":
            return await _analysis_local(prompt, skill_model)
        else:
            logger.error(f"Unknown LLM_PROVIDER: {provider}")
            return f"Analysis unavailable: Unknown provider '{provider}'. Use 'anthropic', 'openai', or 'local'."
    except Exception as e:
        logger.error(f"LLM analysis failed ({provider}): {e}")
        return f"Analysis unavailable ({provider}): {str(e)}"


async def _analysis_anthropic(prompt: str, skill_model: str) -> str | None:
    """Anthropic Claude API."""
    api_key = os.getenv("ANTHROPIC_API_KEY", "")
    if not api_key:
        return None
    model = os.getenv("ANTHROPIC_MODEL", "") or skill_model or "claude-sonnet-4-20250514"
    import anthropic
    client = anthropic.Anthropic(api_key=api_key)
    response = client.messages.create(
        model=model,
        max_tokens=2000,
        messages=[{"role": "user", "content": prompt}],
    )
    return response.content[0].text


async def _analysis_openai(prompt: str, skill_model: str) -> str | None:
    """OpenAI API."""
    api_key = os.getenv("OPENAI_API_KEY", "")
    if not api_key:
        return None
    model = os.getenv("OPENAI_MODEL", "") or skill_model or "gpt-4o"
    base_url = os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1")
    async with httpx.AsyncClient() as client:
        r = await client.post(
            f"{base_url}/chat/completions",
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            json={"model": model, "max_tokens": 2000, "messages": [{"role": "user", "content": prompt}]},
            timeout=120,
        )
        if r.status_code != 200:
            return f"Analysis unavailable: OpenAI returned {r.status_code}: {r.text[:200]}"
        data = r.json()
        return data["choices"][0]["message"]["content"]


async def _analysis_local(prompt: str, skill_model: str) -> str | None:
    """Local LLM via OpenAI-compatible endpoint (Ollama, vLLM, llama.cpp, LocalAI, etc.)."""
    base_url = os.getenv("LOCAL_LLM_BASE_URL", "http://host.docker.internal:11434/v1")
    model = os.getenv("LOCAL_LLM_MODEL", "") or skill_model or "gpt-oss:20b"
    api_key = os.getenv("LOCAL_LLM_API_KEY", "not-needed")
    async with httpx.AsyncClient() as client:
        r = await client.post(
            f"{base_url}/chat/completions",
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            json={"model": model, "max_tokens": 2000, "messages": [{"role": "user", "content": prompt}]},
            timeout=300,  # Local models can be slow
        )
        if r.status_code != 200:
            return f"Analysis unavailable: Local LLM returned {r.status_code}: {r.text[:200]}"
        data = r.json()
        return data["choices"][0]["message"]["content"]
