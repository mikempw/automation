"""Skill store — CRUD operations and SKILL.md parsing.

Extracted from executor.py to keep files under 500 lines.
Handles listing, reading, creating, and deleting skill definitions.
"""
import logging
import os
import re
from pathlib import Path

import frontmatter
import yaml

from ..models import SkillCreate, SkillInfo

logger = logging.getLogger(__name__)

SKILLS_DIR = os.getenv("SKILLS_DIR", "/app/skills")


def _ensure_dir():
    os.makedirs(SKILLS_DIR, exist_ok=True)


# ── CRUD ──────────────────────────────────────────────────────

def list_skills() -> list[SkillInfo]:
    """List all available skills from SKILL.md files."""
    _ensure_dir()
    skills = []
    for entry in sorted(Path(SKILLS_DIR).iterdir()):
        if entry.is_dir():
            skill_file = entry / "SKILL.md"
            if skill_file.exists():
                try:
                    info = parse_skill_info(skill_file)
                    if info:
                        skills.append(info)
                except Exception as e:
                    logger.warning(f"Failed to parse {skill_file}: {e}")
    return skills


def get_skill(name: str) -> dict | None:
    """Get full skill definition including parameters and steps."""
    skill_file = Path(SKILLS_DIR) / name / "SKILL.md"
    if not skill_file.exists():
        return None
    return parse_skill_full(skill_file)


def create_skill(skill: SkillCreate) -> bool:
    """Create a new skill from structured input, writing SKILL.md."""
    _ensure_dir()
    skill_dir = Path(SKILLS_DIR) / skill.name
    skill_dir.mkdir(parents=True, exist_ok=True)

    # Build the SKILL.md content
    fm_data = {
        "name": skill.name,
        "description": skill.description,
        "metadata": {
            "product": skill.product,
            "version": skill.version,
        },
    }
    if skill.author:
        fm_data["metadata"]["author"] = skill.author
    if skill.tags:
        fm_data["metadata"]["tags"] = skill.tags

    # Build markdown body
    body_parts = [f"# {skill.name}\n"]
    body_parts.append(f"{skill.description}\n")

    # Parameters section
    if skill.parameters:
        body_parts.append("## Parameters\n")
        body_parts.append("```yaml")
        params_list = []
        for p in skill.parameters:
            param = {
                "name": p.name,
                "label": p.label,
                "type": p.param_type.value,
                "required": p.required,
            }
            if p.default is not None:
                param["default"] = p.default
            if p.description:
                param["description"] = p.description
            if p.placeholder:
                param["placeholder"] = p.placeholder
            if p.options:
                param["options"] = p.options
            if p.validation_regex:
                param["validation_regex"] = p.validation_regex
            params_list.append(param)
        body_parts.append(yaml.dump(params_list, default_flow_style=False).strip())
        body_parts.append("```\n")

    # Steps section
    if skill.steps:
        body_parts.append("## Steps\n")
        body_parts.append("```yaml")
        steps_list = []
        for s in skill.steps:
            step = {
                "name": s.name,
                "label": s.label,
                "transport": s.transport.value,
                "command_template": s.command_template,
                "timeout": s.timeout,
            }
            if s.rollback_command:
                step["rollback_command"] = s.rollback_command
            if s.description:
                step["description"] = s.description
            steps_list.append(step)
        body_parts.append(yaml.dump(steps_list, default_flow_style=False).strip())
        body_parts.append("```\n")

    # Safety section
    body_parts.append("## Safety\n")
    body_parts.append("```yaml")
    safety = {
        "requires_approval": skill.safety.requires_approval,
        "max_duration": skill.safety.max_duration,
        "destructive": skill.safety.destructive,
        "rollback_enabled": skill.safety.rollback_enabled,
    }
    body_parts.append(yaml.dump(safety, default_flow_style=False).strip())
    body_parts.append("```\n")

    # Analysis section
    if skill.analysis.enabled and skill.analysis.prompt_template:
        body_parts.append("## Analysis\n")
        body_parts.append("```yaml")
        # Replace triple backticks in prompt to avoid breaking the YAML code fence
        sanitized_prompt = skill.analysis.prompt_template.replace("```", "~~~")
        analysis = {
            "enabled": skill.analysis.enabled,
            "model": skill.analysis.model,
            "prompt_template": sanitized_prompt,
        }
        body_parts.append(yaml.dump(analysis, default_flow_style=False).strip())
        body_parts.append("```\n")

    content = "\n".join(body_parts)
    post = frontmatter.Post(content, **fm_data)
    skill_file = skill_dir / "SKILL.md"
    skill_file.write_text(frontmatter.dumps(post))
    logger.info(f"Created skill: {skill.name}")
    return True


def delete_skill(name: str) -> bool:
    """Delete a skill directory."""
    import shutil
    skill_dir = Path(SKILLS_DIR) / name
    if skill_dir.exists():
        shutil.rmtree(skill_dir)
        return True
    return False


# ── Parsing ──────────────────────────────────────────────────

def parse_skill_info(skill_file: Path) -> SkillInfo | None:
    """Parse SKILL.md frontmatter into SkillInfo."""
    post = frontmatter.load(str(skill_file))
    meta = post.metadata.get("metadata", {})
    content = post.content

    # Count params and steps from yaml blocks
    param_count = 0
    step_count = 0
    has_analysis = False
    requires_approval = True
    destructive = False
    transports = set()

    yaml_blocks = re.findall(r"```yaml\n(.*?)```", content, re.DOTALL)
    for i, block in enumerate(yaml_blocks):
        try:
            parsed = yaml.safe_load(block)
            if isinstance(parsed, list) and len(parsed) > 0:
                if "command_template" in parsed[0]:
                    step_count = len(parsed)
                    for step in parsed:
                        t = step.get("transport", "ssh")
                        transports.add(t)
                elif "label" in parsed[0]:
                    param_count = len(parsed)
            elif isinstance(parsed, dict):
                if "requires_approval" in parsed:
                    requires_approval = parsed.get("requires_approval", True)
                    destructive = parsed.get("destructive", False)
                if "enabled" in parsed and "prompt_template" in parsed:
                    has_analysis = parsed.get("enabled", False)
        except Exception:
            pass

    return SkillInfo(
        name=post.metadata.get("name", skill_file.parent.name),
        description=post.metadata.get("description", ""),
        product=meta.get("product", "unknown"),
        version=meta.get("version", "1.0"),
        author=meta.get("author"),
        tags=meta.get("tags", []),
        parameter_count=param_count,
        step_count=step_count,
        requires_approval=requires_approval,
        has_analysis=has_analysis,
        transports=sorted(transports),
        destructive=destructive,
    )


def parse_skill_full(skill_file: Path) -> dict:
    """Parse full skill definition including params, steps, safety, analysis."""
    post = frontmatter.load(str(skill_file))
    meta = post.metadata.get("metadata", {})
    content = post.content

    result = {
        "name": post.metadata.get("name", skill_file.parent.name),
        "description": post.metadata.get("description", ""),
        "product": meta.get("product", "unknown"),
        "version": meta.get("version", "1.0"),
        "author": meta.get("author"),
        "tags": meta.get("tags", []),
        "metadata": meta,
        "parameters": [],
        "steps": [],
        "safety": {"requires_approval": True, "max_duration": 60, "destructive": False, "rollback_enabled": False},
        "analysis": {"enabled": False, "model": "claude-sonnet-4-20250514", "prompt_template": ""},
        "raw_content": content,
    }

    # Parse yaml blocks in order: params, steps, safety, analysis
    yaml_blocks = re.findall(r"```yaml\n(.*?)```", content, re.DOTALL)
    for block in yaml_blocks:
        try:
            parsed = yaml.safe_load(block)
            if isinstance(parsed, list) and len(parsed) > 0:
                first = parsed[0]
                if "command_template" in first:
                    result["steps"] = parsed
                elif "label" in first or "param_type" in first or "type" in first:
                    result["parameters"] = parsed
            elif isinstance(parsed, dict):
                if "requires_approval" in parsed:
                    result["safety"] = parsed
                elif "prompt_template" in parsed:
                    result["analysis"] = parsed
        except Exception:
            pass

    return result
