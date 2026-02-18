from __future__ import annotations
from pydantic import BaseModel, Field
from typing import Optional
from enum import Enum


# ── Device Models ────────────────────────────────────────────

class DeviceType(str, Enum):
    BIGIP = "bigip"
    NGINX = "nginx"
    NGINX_PLUS = "nginx_plus"


class TransportType(str, Enum):
    SSH = "ssh"
    ICONTROL_REST = "icontrol_rest"
    NGINX_API = "nginx_api"
    PROXMOX_API = "proxmox_api"


class AuthMethod(str, Enum):
    PASSWORD = "password"
    SSH_KEY = "ssh_key"


class DeviceCreate(BaseModel):
    hostname: str = Field(..., description="Device hostname or FQDN")
    mgmt_ip: str = Field(..., description="Management IP address")
    device_type: DeviceType = Field(..., description="Type of device")
    port: int = Field(default=22, description="SSH port")
    ssh_auth_method: AuthMethod = Field(default=AuthMethod.PASSWORD, description="SSH authentication method")
    username: str = Field(..., description="SSH username")
    password: Optional[str] = Field(default=None, description="SSH password (required for password auth)")
    ssh_private_key: Optional[str] = Field(default=None, description="SSH private key PEM (required for key auth)")
    rest_username: Optional[str] = Field(default=None, description="iControl REST username (BIG-IP only)")
    rest_password: Optional[str] = Field(default=None, description="iControl REST password (BIG-IP only)")
    description: Optional[str] = Field(default=None, description="Optional description")
    tags: list[str] = Field(default_factory=list, description="Tags for grouping")


class DeviceInfo(BaseModel):
    """Device info returned to the frontend (no credentials)."""
    hostname: str
    mgmt_ip: str
    device_type: DeviceType
    port: int
    ssh_auth_method: str = "password"
    description: Optional[str] = None
    tags: list[str] = []
    status: str = "unknown"


# ── Skill Models ─────────────────────────────────────────────

class SkillParamType(str, Enum):
    STRING = "string"
    TEXTAREA = "textarea"
    INTEGER = "integer"
    BOOLEAN = "boolean"
    SELECT = "select"
    IP_ADDRESS = "ip_address"
    PORT = "port"


class SkillParam(BaseModel):
    name: str = Field(..., description="Parameter name (snake_case)")
    label: str = Field(..., description="Human-readable label")
    param_type: SkillParamType = Field(default=SkillParamType.STRING)
    required: bool = Field(default=True)
    default: Optional[str] = Field(default=None)
    description: str = Field(default="", description="Help text shown as tooltip")
    placeholder: Optional[str] = Field(default=None)
    options: list[str] = Field(default_factory=list, description="Options for select type")
    validation_regex: Optional[str] = Field(default=None, description="Regex for validation")


class SkillStep(BaseModel):
    name: str = Field(..., description="Step identifier")
    label: str = Field(..., description="Human-readable step label")
    transport: TransportType = Field(default=TransportType.SSH)
    command_template: str = Field(..., description="Command with {{param}} placeholders")
    timeout: int = Field(default=30, description="Timeout in seconds")
    expect_output: bool = Field(default=True, description="Whether to capture output")
    rollback_command: Optional[str] = Field(default=None, description="Command to undo this step")
    description: Optional[str] = Field(default=None, description="What this step does")


class SkillSafety(BaseModel):
    requires_approval: bool = Field(default=True, description="Require user confirmation before execution")
    max_duration: int = Field(default=60, description="Maximum total execution time in seconds")
    destructive: bool = Field(default=False, description="Whether this skill modifies device state")
    rollback_enabled: bool = Field(default=False, description="Whether rollback is available on failure")


class SkillAnalysis(BaseModel):
    enabled: bool = Field(default=True, description="Enable LLM analysis of output")
    prompt_template: str = Field(default="", description="LLM prompt template with {{output}} and {{params}} placeholders")
    model: str = Field(default="claude-sonnet-4-20250514", description="Model to use for analysis")


class SkillCreate(BaseModel):
    name: str = Field(..., description="Skill name (lowercase-hyphenated, max 64 chars)")
    description: str = Field(..., description="What this skill does and when to use it (max 1024 chars)")
    product: str = Field(..., description="Target product: bigip, nginx, nginx_plus")
    version: str = Field(default="1.0", description="Skill version")
    author: Optional[str] = Field(default=None, description="Skill author")
    tags: list[str] = Field(default_factory=list)
    parameters: list[SkillParam] = Field(default_factory=list)
    steps: list[SkillStep] = Field(default_factory=list)
    safety: SkillSafety = Field(default_factory=SkillSafety)
    analysis: SkillAnalysis = Field(default_factory=SkillAnalysis)


class SkillInfo(BaseModel):
    """Skill metadata returned for listing."""
    name: str
    description: str
    product: str
    version: str
    author: Optional[str] = None
    tags: list[str] = []
    parameter_count: int = 0
    step_count: int = 0
    requires_approval: bool = True
    has_analysis: bool = False
    transports: list[str] = []
    destructive: bool = False


# ── Execution Models ─────────────────────────────────────────

class ExecutionStatus(str, Enum):
    PENDING = "pending"
    AWAITING_APPROVAL = "awaiting_approval"
    RUNNING = "running"
    ANALYZING = "analyzing"
    COMPLETE = "complete"
    FAILED = "failed"
    CANCELLED = "cancelled"
    ROLLED_BACK = "rolled_back"


class StepResult(BaseModel):
    step_name: str
    status: ExecutionStatus
    command: str = ""
    output: str = ""
    error: Optional[str] = None
    duration_ms: int = 0


class ExecutionRequest(BaseModel):
    skill_name: str
    device_hostname: str
    parameters: dict = Field(default_factory=dict)


class ExecutionResult(BaseModel):
    execution_id: str
    skill_name: str
    device_hostname: str
    status: ExecutionStatus
    parameters: dict = {}
    steps: list[StepResult] = []
    analysis: Optional[str] = None
    started_at: Optional[str] = None
    completed_at: Optional[str] = None
    error: Optional[str] = None
