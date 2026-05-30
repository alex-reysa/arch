# Arch `.arch` Language Specification

**Status:** V1 language specification  
**Applies to:** Arch V1  
**File extension:** `.arch`  
**Primary source file:** `backend.arch`  
**Compiles to:** `arch.ir.v1`  
**Default V1 target:** TypeScript, Node.js, Fastify, PostgreSQL, Prisma, Redis by default or `cache: none`, Vitest, Docker Compose, pnpm

---

## 1. Overview

The `.arch` language is the human-authored specification language for Arch.

Arch is a spec-to-code synchronization system for AI-generated TypeScript backend workflow services. Developers write `.arch` files to describe backend system intent at a higher level than implementation code. In V1, one `backend.arch` source file describes one generated backend service per project. The Arch compiler parses `.arch`, validates it, compiles it into canonical typed IR, stores IR snapshots, computes semantic diffs across versions, maps those diffs to implementation artifacts, constrains code-generation or patching agents, and verifies the resulting backend against generated tests and declared guarantees.

The central rule is:

```text
.arch source is for humans.
Canonical IR is for the compiler.
Generated implementation is a build artifact.
```

`.arch` is **not** a prompt. It is not a bag of natural-language instructions for an LLM to interpret.

`.arch` is **not** implementation code. It does not contain TypeScript, SQL, Prisma schema text, test code, or arbitrary executable logic.

`.arch` is a structured, deterministic, version-controlled specification of backend intent. It describes:

```text
- the system
- the target backend stack
- persistent models
- fields and constraints
- relations
- workflows
- workflow triggers
- bounded workflow steps
- integrations
- policies
- behavioral guarantees
- generated and custom test requirements
- custom extension points
```

The V1 language is deliberately narrow. It is designed to be expressive enough for backend workflow services while remaining structured enough for deterministic parsing, typed semantic validation, canonical IR generation, useful compiler errors, minimal diffs, and safe synchronization. It is not a general app generator, frontend generator, multi-service orchestration language, or arbitrary backend framework selector.

---

## 2. Language Design Goals

### 2.1 Human-readable

A backend engineer should be able to read a `.arch` file and understand the intended backend system without reading generated code first.

The language uses familiar block syntax, named declarations, simple key-value properties, and a bounded set of workflow step forms.

### 2.2 Machine-parseable

Every construct has a grammar. The parser must not depend on an LLM to interpret source text.

Whitespace is mostly insignificant. Braces define blocks. Declaration keywords identify construct types. Workflow steps use a fixed vocabulary.

### 2.3 Deterministic

The same semantic `.arch` input must compile to the same canonical IR.

Formatting changes, comment changes, blank lines, and equivalent shorthand must not produce implementation diffs. Workflow step order and enum value order are semantic and must produce IR changes when they change.

### 2.4 Version-control friendly

`.arch` files should produce readable diffs. Declarations are line-oriented where possible. Fields, steps, guarantees, and tests are easy to add, remove, and reorder.

### 2.5 Typed and semantically validated

The compiler resolves references between models, fields, workflows, integrations, guarantees, policies, and tests before code generation.

Invalid references, unsupported V1 features, ambiguous declarations, incompatible constraints, and impossible guarantees are rejected with source locations.

### 2.6 Compilable into Arch IR

`.arch` is not the canonical compiler boundary. It compiles into `arch.ir.v1`.

The IR removes shorthand, expands defaults, resolves references, assigns stable entity IDs, records source locations, and produces a deterministic representation for diffing, planning, artifact mapping, generation, testing, drift detection, and repair.

### 2.7 Bounded before agentic implementation

The language should reduce ambiguity before LLM agents are used. Agents receive typed diffs and IR fragments; they do not infer the meaning of free-form `.arch` prose.

### 2.8 Explicitly limited

Unsupported V1 features are rejected. Manual or partial status is allowed only for supported constructs whose verification is explicitly manual or partial in IR, such as latency guarantees. The compiler must not silently delegate unsupported semantics to implementation agents.

---

## 3. Syntax Style

### 3.1 Chosen style

V1 uses a custom block syntax inspired by Terraform/HCL and typed pseudo-code:

```arch
system SocialFeed {
  target {
    runtime: node.fastify
    database: postgres
    orm: prisma
    cache: redis
    auth: oauth.github
  }

  model Post {
    id: uuid primary
    content: string max 5000
    visibility: enum["public", "private", "followers"] default "public"
  }

  workflow CreatePost {
    trigger: api.POST("/posts")

    steps {
      validate input as Post
      sanitize Post.content as html_safe
      insert Post
    }

    guarantees {
      no_unsanitized_html_persisted
    }
  }
}
```

### 3.2 Why not YAML

YAML is familiar, but its implicit typing, indentation sensitivity, merge keys, aliases, and multiple equivalent forms can make deterministic compiler behavior harder.

`.arch` should be easy to format and parse with explicit block boundaries.

### 3.3 Why not JSON

JSON is deterministic but too verbose for everyday authoring. It is appropriate for the canonical IR, not the human source language.

### 3.4 Why not a TypeScript DSL

A TypeScript DSL would be familiar to V1 users, but it would blur the boundary between system intent and implementation code. It could also require executing or type-checking user code before semantic validation.

`.arch` must remain declarative and non-executable.

### 3.5 Why not unconstrained natural language

Natural language can be useful for discovery, but it is not reliable as an executable contract. In `.arch`, natural-language descriptions are allowed only as metadata in long-form declarations. They are not sufficient to define executable behavior unless paired with structured fields.

---

## 4. File Structure

### 4.1 V1 file count

V1 supports one primary source file:

```text
backend.arch
```

Additional `.arch` files are out of scope unless a future deterministic preprocessor merges them before parsing.

### 4.2 Root declaration

A `.arch` document must contain exactly one root `system` declaration.

```arch
system SocialFeed {
  // declarations go here
}
```

### 4.3 Allowed top-level declarations inside `system`

Inside `system`, V1 allows:

```text
target
model
integration
custom
policy
policies
workflow
guarantee
guarantees
tests
```

`target` must occur exactly once.

`model`, `integration`, `custom`, `policy`, `workflow`, `guarantee`, and `tests` may occur multiple times unless otherwise constrained.

`policies` and `guarantees` blocks are collection blocks containing short-form entries.

`custom` is a source-level extension point declaration. It compiles to `CustomExtensionIR` so extension stubs, ownership metadata, call sites, and future diffs have a stable typed anchor.

### 4.4 Declaration ordering

Declaration order is mostly not semantic, except for workflow step order and enum value order.

The compiler may resolve forward references. For example, a workflow may reference an integration declared later in the file.

A formatter should use this recommended order:

```text
system
  target
  models
  integrations
  custom extension points
  policies
  top-level guarantees
  workflows
  top-level tests
```

The formatter must not reorder workflow steps or enum values.

Reordering any other declaration should not change the canonical IR unless the reordered construct is explicitly defined as ordered by this specification.

---

## 5. Lexical Rules

### 5.1 Encoding

`.arch` source files must be UTF-8.

The compiler should normalize line endings to `\n` for parsing and source hashing.

### 5.2 Whitespace

Spaces, tabs, and newlines separate tokens. Indentation is not semantically significant, but the formatter should use two spaces per indentation level.

### 5.3 Comments

V1 supports three comment forms:

```arch
// line comment
# line comment
/* block comment */
```

Comments are ignored by semantic compilation but preserved by formatters where practical.

Comments do not appear in canonical IR.

### 5.4 Identifiers

V1 identifiers are ASCII and must match:

```text
[A-Za-z_][A-Za-z0-9_]*
```

Recommended conventions:

| Construct | Convention | Example |
|---|---|---|
| System names | UpperCamelCase | `SocialFeed` |
| Model names | UpperCamelCase | `Post` |
| Workflow names | UpperCamelCase | `CreatePost` |
| Integration names | UpperCamelCase | `PushProvider` |
| Custom extension names | UpperCamelCase | `PostRankingStrategy` |
| Field names | snake_case or lowerCamelCase | `created_at`, `email` |
| Policy names | UpperCamelCase or snake_case | `RequireAuth`, `require_auth` |
| Guarantee names | snake_case | `no_unsanitized_html_persisted` |
| Test names | snake_case | `create_post_html_safety` |

The parser accepts any valid identifier. Semantic validation may enforce additional style rules for stable generated names.

### 5.5 Qualified identifiers

Qualified identifiers use dots:

```arch
Post.content
workflow.CreatePost
integration.PushProvider
model.Post.field.content
```

A qualified identifier is a sequence of identifiers separated by `.`:

```text
Identifier ("." Identifier)*
```

Qualified identifiers are used for model fields, explicit IR-like references, policy scopes, guarantee scopes, and custom test scopes.

### 5.6 Keywords

The following words are reserved in V1:

```text
system
target
model
field
relation
workflow
trigger
steps
step
integration
policy
policies
guarantee
guarantees
test
tests
custom
input
output
scope
category
assert
verify
verifiability
description
kind
provider
required
optional
primary
unique
indexed
index
immutable
default
max
min
relation
via
on_delete
cascade
restrict
set_null
no_action
validate
sanitize
moderate
insert
update
delete
query
call
notify
enqueue
return
if
else
using
with
as
for
via
when
on_error
retry
then
continue
fail
record_error
best_effort
manual
schedule
api
true
false
none
now
uuid
```

Reserved words may not be used as unquoted identifiers.

### 5.7 String literals

String literals use double quotes:

```arch
"/posts"
"public"
"src/custom/postRankingStrategy.ts"
```

Supported escapes:

```text
\\  backslash
\"  double quote
\n  newline
\r  carriage return
\t  tab
\uXXXX Unicode code point
```

Single-quoted strings are not supported in V1.

Multiline string literals are not supported in V1. Use metadata files or custom code for long descriptions.

### 5.8 Numbers

Integer literals:

```text
0
1
5000
```

Decimal literals:

```text
0.5
10.25
```

Underscores in numeric literals are not supported in V1.

### 5.9 Booleans

Boolean literals are:

```arch
true
false
```

### 5.10 Durations

Duration literals are numeric values followed immediately by a unit:

```arch
200ms
2s
```

Supported V1 units:

```text
ms
s
```

Durations compile to `DurationIR`.

Example:

```arch
post_creation_p95_latency <= 200ms
```

Canonical IR:

```json
{ "value": 200, "unit": "ms" }
```

### 5.11 Paths

API paths are strings beginning with `/`:

```arch
api.POST("/posts")
api.GET("/users/:id")
```

V1 API paths must not include query strings.

File paths are strings and must be repository-relative:

```arch
file: "src/custom/postRankingStrategy.ts"
```

Absolute paths are invalid.

---

## 6. Grammar

This grammar is implementable EBNF-style notation. It is intentionally more explicit than mathematically minimal.

### 6.1 Grammar conventions

```text
"literal"      exact token
A B            sequence
A | B          choice
A?             optional
A*             zero or more
A+             one or more
( A )          grouping
```

Newlines are generally not semantic, except that a declaration or statement ends at a newline, semicolon, or closing brace when the grammar permits line-oriented forms.

### 6.2 Lexical grammar

```ebnf
Document          ::= Spacing SystemDecl Spacing EOF

Identifier        ::= /[A-Za-z_][A-Za-z0-9_]*/
QualifiedIdent    ::= Identifier ("." Identifier)*
TypeIdent         ::= Identifier
FieldIdent        ::= Identifier
StringLiteral     ::= '"' StringChar* '"'
NumberLiteral     ::= IntegerLiteral | DecimalLiteral
IntegerLiteral    ::= /0|[1-9][0-9]*/
DecimalLiteral    ::= /[0-9]+\.[0-9]+/
BooleanLiteral    ::= "true" | "false"
DurationLiteral   ::= NumberLiteral ("ms" | "s")

StringChar        ::= /[^"\\]/ | EscapeSequence
EscapeSequence    ::= "\\" ("\\" | '"' | "n" | "r" | "t" | UnicodeEscape)
UnicodeEscape     ::= "u" Hex Hex Hex Hex
Hex               ::= /[0-9A-Fa-f]/

Spacing           ::= (Whitespace | Comment)*
Whitespace        ::= /[ \t\r\n]+/
Comment           ::= LineComment | HashComment | BlockComment
LineComment       ::= "//" /[^\n]*/
HashComment       ::= "#" /[^\n]*/
BlockComment      ::= "/*" .* "*/"
```

### 6.3 Document grammar

```ebnf
SystemDecl        ::= "system" TypeIdent Block<SystemBody>

SystemBody        ::= SystemItem*
SystemItem        ::= TargetBlock
                    | ModelDecl
                    | IntegrationDecl
                    | CustomDecl
                    | PolicyDecl
                    | PoliciesBlock
                    | GuaranteeDecl
                    | GuaranteesBlock
                    | WorkflowDecl
                    | TestsBlock

Block<T>          ::= "{" T "}"
```

### 6.4 Target grammar

```ebnf
TargetBlock       ::= "target" Block<TargetBody>
TargetBody        ::= TargetProperty*

TargetProperty    ::= "language" ":" TargetValue Terminator?
                    | "runtime" ":" TargetValue Terminator?
                    | "database" ":" TargetValue Terminator?
                    | "orm" ":" TargetValue Terminator?
                    | "cache" ":" TargetValue Terminator?
                    | "auth" ":" TargetValue Terminator?
                    | "test_framework" ":" TargetValue Terminator?
                    | "local_runtime" ":" TargetValue Terminator?
                    | "package_manager" ":" TargetValue Terminator?

TargetValue       ::= QualifiedIdent | Identifier | "none"
Terminator        ::= ";"
```

### 6.5 Model grammar

```ebnf
ModelDecl         ::= "model" TypeIdent Block<ModelBody>
ModelBody         ::= ModelItem*
ModelItem         ::= FieldDecl Terminator?
                    | RelationDecl Terminator?
                    | IndexDecl Terminator?

FieldDecl         ::= FieldIdent ":" TypeExpr FieldModifier*

TypeExpr          ::= ScalarType
                    | EnumType
                    | ModelRefType
                    | ArrayType

ScalarType        ::= "string"
                    | "text"
                    | "int"
                    | "bigint"
                    | "float"
                    | "decimal"
                    | "boolean"
                    | "uuid"
                    | "timestamp"
                    | "datetime"
                    | "date"
                    | "json"

EnumType          ::= "enum" "[" StringLiteral ("," StringLiteral)* "]"
ModelRefType      ::= TypeIdent
ArrayType         ::= (ScalarType | ModelRefType) "[]"

FieldModifier     ::= RequiredModifier
                    | PrimaryModifier
                    | UniqueModifier
                    | IndexModifier
                    | ImmutableModifier
                    | DefaultModifier
                    | LengthModifier
                    | RelationModifier
                    | DeleteModifier

RequiredModifier  ::= "required" | "optional"
PrimaryModifier   ::= "primary"
UniqueModifier    ::= "unique"
IndexModifier     ::= "indexed" | "index"
ImmutableModifier ::= "immutable"
DefaultModifier   ::= "default" DefaultValue
LengthModifier    ::= ("max" | "min") IntegerLiteral
RelationModifier  ::= "relation" RelationCardinality ("via" QualifiedIdent)?
DeleteModifier    ::= "on_delete" DeleteAction

DefaultValue      ::= StringLiteral | NumberLiteral | BooleanLiteral | "now" | "uuid" | "none"
RelationCardinality ::= "many_to_one" | "one_to_many" | "one_to_one" | "many_to_many"
DeleteAction      ::= "restrict" | "cascade" | "set_null" | "no_action"

RelationDecl      ::= "relation" Identifier Block<RelationBody>
RelationBody      ::= RelationProperty*
RelationProperty  ::= "from" ":" QualifiedIdent Terminator?
                    | "to" ":" QualifiedIdent Terminator?
                    | "field" ":" QualifiedIdent Terminator?
                    | "cardinality" ":" RelationCardinality Terminator?
                    | "required" ":" BooleanLiteral Terminator?
                    | "on_delete" ":" DeleteAction Terminator?

IndexDecl         ::= "index" Identifier? "(" FieldIdent ("," FieldIdent)* ")" IndexModifier*
```

V1 support notes:

```text
- `many_to_many` is reserved so parsers can emit precise errors, but it does not compile to V1 IR.
- Scalar `T[]` fields are reserved and invalid. `Model[]` is allowed only for inverse `one_to_many` relation views with `via`.
- A `relation Name { ... }` block is supported only as an explicit declaration for an existing model-reference field in the same model. It does not create fields by itself.
- Named `index ...` declarations are reserved and invalid in normal V1. Use field-level `indexed` / `index`.
```

### 6.6 Integration grammar

```ebnf
IntegrationDecl   ::= "integration" TypeIdent Block<IntegrationBody>
IntegrationBody   ::= IntegrationItem*
IntegrationItem   ::= IntegrationProperty Terminator?
                    | ConfigBlock

IntegrationProperty ::= "kind" ":" IntegrationKind
                      | "provider" ":" IntegrationProvider
                      | "required" ":" BooleanLiteral
                      | "failure_policy" ":" FailurePolicy

IntegrationKind   ::= "llm_moderation"
                    | "push"
                    | "email"
                    | "cache"
                    | "auth"
                    | "custom"

IntegrationProvider ::= Identifier | QualifiedIdent | StringLiteral
FailurePolicy     ::= "fail_workflow" | "best_effort" | "retry" | "custom"

ConfigBlock       ::= "config" Block<ConfigBody>
ConfigBody        ::= ConfigField*
ConfigField       ::= FieldIdent ":" ConfigType ConfigModifier* Terminator?
ConfigType        ::= "string" | "boolean" | "int" | "secret" | "json"
ConfigModifier    ::= "required" | "optional" | "default" DefaultValue
```

### 6.7 Custom extension grammar

```ebnf
CustomDecl        ::= "custom" TypeIdent Block<CustomBody>
CustomBody        ::= CustomProperty*
CustomProperty    ::= "kind" ":" CustomKind Terminator?
                    | "input" ":" TypeRefList Terminator?
                    | "output" ":" TypeRef Terminator?
                    | "file" ":" StringLiteral Terminator?
                    | "export" ":" StringLiteral Terminator?

CustomKind        ::= "function" | "workflow_step" | "policy" | "test_generator"
TypeRefList       ::= TypeRef ("," TypeRef)*
TypeRef           ::= QualifiedIdent | TypeIdent | ScalarType
```

### 6.8 Policy grammar

```ebnf
PolicyDecl        ::= "policy" Identifier Block<PolicyBody>
PolicyBody        ::= PolicyItem*
PolicyItem        ::= PolicyProperty Terminator?
                    | RuleBlock

PolicyProperty    ::= "kind" ":" PolicyKind
                    | "scope" ":" ScopeList
                    | "enforcement" ":" PolicyEnforcement

PolicyKind        ::= "auth"
                    | "authorization"
                    | "retry"
                    | "transaction"
                    | "idempotency"
                    | "cache"
                    | "rate_limit"
                    | "custom"

PolicyEnforcement ::= "generated_code" | "runtime_assertion" | "manual" | "custom"
ScopeList         ::= ScopeExpr ("," ScopeExpr)*
ScopeExpr         ::= QualifiedIdent | "system" | "all" "api" "routes"

RuleBlock         ::= "rules" Block<RuleBody>
RuleBody          ::= RuleLine*
RuleLine          ::= RuleExpr Terminator?
RuleExpr          ::= RulePath RuleOperator RuleValue
RulePath          ::= QualifiedIdent
RuleOperator      ::= "==" | "!=" | "<=" | ">=" | "<" | ">" | "in"
RuleValue         ::= StringLiteral
                    | NumberLiteral
                    | BooleanLiteral
                    | DurationLiteral
                    | QualifiedIdent
                    | ArrayLiteral

ArrayLiteral      ::= "[" RuleValue ("," RuleValue)* "]"

PoliciesBlock     ::= "policies" Block<PolicyShortLine*>
PolicyShortLine   ::= "require" "auth" "for" "all" "api" "routes" Terminator?
                    | "require" "audit_log" "for" "llm" "decisions" Terminator?
                    | "use" Identifier Terminator?
```

### 6.9 Workflow grammar

```ebnf
WorkflowDecl      ::= "workflow" TypeIdent Block<WorkflowBody>
WorkflowBody      ::= WorkflowItem*
WorkflowItem      ::= TriggerDecl Terminator?
                    | WorkflowProperty Terminator?
                    | StepsBlock
                    | GuaranteesBlock
                    | TestsBlock
                    | PoliciesBlock

WorkflowProperty  ::= "input" ":" TypeRef
                    | "output" ":" TypeRef
                    | "on_error" ":" FailureBehavior

TriggerDecl       ::= "trigger" ":" TriggerExpr
TriggerExpr       ::= ApiTrigger | ManualTrigger | ScheduleTrigger
ApiTrigger        ::= "api" "." ApiMethod "(" StringLiteral ")" TriggerModifier*
ApiMethod         ::= "GET" | "POST" | "PUT" | "PATCH" | "DELETE"
TriggerModifier   ::= "auth" ("required" | "optional")
ManualTrigger     ::= "manual" ("(" StringLiteral ")")?
ScheduleTrigger   ::= "schedule" "." "cron" "(" StringLiteral ")"

StepsBlock        ::= "steps" Block<StepLine*>
StepLine          ::= StepExpr Terminator?
StepExpr          ::= ValidateStep
                    | ModerateStep
                    | SanitizeStep
                    | InsertStep
                    | UpdateCacheStep
                    | NotifyStep
                    | CallCustomStep
                    | ReturnStep
                    | ReservedStep

ValidateStep      ::= "validate" "input" ("as" TypeRef)? StepModifier*
ModerateStep      ::= "moderate" FieldRef "using" Identifier StepModifier*
SanitizeStep      ::= "sanitize" FieldRef "as" SanitizerMode StepModifier*
InsertStep        ::= "insert" TypeIdent StepModifier*
UpdateCacheStep   ::= "update" Identifier "for" PathExpr StepModifier*
NotifyStep        ::= "notify" AudienceExpr "via" Identifier StepModifier*
CallCustomStep    ::= "call" "custom" Identifier ("with" ArgumentList)? StepModifier*
ReturnStep        ::= "return" ReturnExpr? StepModifier*

ReservedStep      ::= QueryStep | UpdateModelStep | DeleteStep | EnqueueStep | IfStep | CallIntegrationStep
QueryStep         ::= "query" .*
UpdateModelStep   ::= "update" TypeIdent .*
DeleteStep        ::= "delete" TypeIdent .*
EnqueueStep       ::= "enqueue" .*
IfStep            ::= "if" .*
CallIntegrationStep ::= "call" "integration" .*

FieldRef          ::= TypeIdent "." FieldIdent
PathExpr          ::= QualifiedIdent
AudienceExpr      ::= Identifier | QualifiedIdent
ArgumentList      ::= ArgumentExpr ("," ArgumentExpr)*
ArgumentExpr      ::= QualifiedIdent | StringLiteral | NumberLiteral | BooleanLiteral
ReturnExpr        ::= QualifiedIdent | TypeIdent | StringLiteral
SanitizerMode     ::= "html_safe" | "plain_text" | "trim" | "lowercase"

StepModifier      ::= FailureModifier
                    | RetryModifier
                    | TransactionModifier
                    | ConditionModifier

FailureModifier   ::= "required" | "best_effort" | "record_error"
RetryModifier     ::= "retry" IntegerLiteral "then" ("continue" | "fail")
TransactionModifier ::= "inside_transaction" | "outside_transaction"
ConditionModifier ::= "when" PredicateRef
PredicateRef      ::= QualifiedIdent

FailureBehavior   ::= "rollback_workflow"
                    | "continue"
                    | "record_error"
                    | "retry_then_continue"
                    | "retry_then_fail"
```

`ReservedStep` forms are recognized by syntax highlighters and parsers so that helpful V1 errors can be emitted. They do not compile to executable V1 IR unless explicitly listed as supported in Section 13.

### 6.10 Guarantee grammar

```ebnf
GuaranteesBlock   ::= "guarantees" Block<GuaranteeEntry*>
GuaranteeEntry    ::= GuaranteeShortLine Terminator?
                    | GuaranteeDecl

GuaranteeDecl     ::= "guarantee" Identifier Block<GuaranteeBody>
GuaranteeBody     ::= GuaranteeProperty*
GuaranteeProperty ::= "scope" ":" ScopeList Terminator?
                    | "category" ":" GuaranteeCategory Terminator?
                    | "description" ":" StringLiteral Terminator?
                    | "assert" ":" PredicateExpr Terminator?
                    | "verify" ":" VerificationStrategy Terminator?
                    | "verifiability" ":" Verifiability Terminator?

GuaranteeShortLine ::= Identifier GuaranteeComparison?
GuaranteeComparison ::= CompareOperator (DurationLiteral | NumberLiteral | StringLiteral | BooleanLiteral)
CompareOperator   ::= "<=" | ">=" | "<" | ">" | "==" | "!="

GuaranteeCategory ::= "data_integrity"
                    | "transactional_behavior"
                    | "security_safety"
                    | "moderation"
                    | "latency"
                    | "integration_failure"
                    | "authorization"
                    | "custom"

VerificationStrategy ::= "unit_test"
                       | "integration_test"
                       | "contract_test"
                       | "static_check"
                       | "runtime_assertion"
                       | "load_test_scaffold"
                       | "manual_review"
                       | "custom"

Verifiability     ::= "testable"
                    | "partially_verifiable"
                    | "runtime_assertable"
                    | "manual"
                    | "unsupported"

PredicateExpr     ::= PersistedPredicate
                    | FailureRollbackPredicate
                    | LatencyPredicate
                    | StepOrderPredicate
                    | AuthPredicate
                    | CustomPredicate

PersistedPredicate ::= "persisted" "(" FieldRef ")" "satisfies" Identifier
FailureRollbackPredicate ::= "failure" "(" QualifiedIdent ")" "does_not" "rollback" "insert" "(" TypeIdent ")"
LatencyPredicate  ::= "latency" "." "p95" "(" QualifiedIdent ")" "<=" DurationLiteral
StepOrderPredicate ::= "step" "(" QualifiedIdent ")" "before" "step" "(" QualifiedIdent ")"
AuthPredicate     ::= "auth" "." "required" "(" QualifiedIdent ")"
CustomPredicate   ::= "custom" "(" StringLiteral ")" "references" "[" ScopeList "]"
```

### 6.11 Test grammar

```ebnf
TestsBlock        ::= "tests" Block<TestEntry*>
TestEntry         ::= TestShortLine Terminator?
                    | TestDecl

TestDecl          ::= "test" Identifier Block<TestBody>
TestBody          ::= TestProperty*
TestProperty      ::= "kind" ":" TestKind Terminator?
                    | "scope" ":" ScopeList Terminator?
                    | "guarantee" ":" Identifier Terminator?
                    | "path" ":" StringLiteral Terminator?
                    | "generated" ":" BooleanLiteral Terminator?

TestShortLine     ::= "generate" TestKindPlural "for" ScopeExpr
                    | "verify" "guarantee" Identifier "with" TestKind
                    | "include" "custom" StringLiteral

TestKind          ::= "unit"
                    | "integration"
                    | "contract"
                    | "static"
                    | "load_scaffold"

TestKindPlural    ::= "unit_tests"
                    | "integration_tests"
                    | "contract_tests"
                    | "static_checks"
                    | "load_test_scaffold"
                    | "property_tests"
```

`property_tests` is reserved but unsupported in V1.

---

## 7. Source Language Values and Literals

### 7.1 Value categories

The source language has these value categories:

| Category | Examples | Used in |
|---|---|---|
| Identifier | `Post`, `PushProvider` | declarations and references |
| Qualified identifier | `Post.content`, `workflow.CreatePost` | field refs and scopes |
| String | `"/posts"`, `"public"` | paths, enum values, provider names |
| Number | `5000`, `0.5` | length limits, thresholds |
| Boolean | `true`, `false` | flags |
| Duration | `200ms`, `2s` | latency and retry policies |
| Array literal | `["admin", "owner"]` | policy rules |

### 7.2 Nulls

V1 does not have a general `null` literal.

Use `none` only in fields where the spec explicitly allows it, such as:

```arch
cache: none
auth: none
default none
```

`default none` means no default. It is rarely needed because absence of `default` already means no default.

---

## 8. Type System

### 8.1 Type design

Types describe persisted model fields, workflow input/output references, custom extension contracts, policy values, and guarantee predicates.

All model field types compile to IR `TypeDescriptorIR` unless explicitly marked unsupported.

### 8.2 Requiredness default

V1 uses this default:

```text
Fields are required unless marked optional.
```

Examples:

```arch
email: string unique
bio: string max 280 optional
```

`email` is required. `bio` is optional.

The formatter should preserve explicit `required` and `optional`. Teams may choose to always write one of them for readability.

### 8.3 Primitive type table

| `.arch` type | V1 status | IR mapping | Prisma mapping | PostgreSQL mapping | Notes |
|---|---:|---|---|---|---|
| `string` | supported | `{ "kind": "string" }` | `String` | `text` or `varchar(n)` when `max` is present | Use for bounded strings. |
| `text` | supported | `{ "kind": "text" }` | `String` | `text` | Use for long unbounded text. |
| `int` | supported | `{ "kind": "int" }` | `Int` | `integer` | 32-bit signed integer. |
| `bigint` | supported | `{ "kind": "bigint" }` | `BigInt` | `bigint` | Use for large integer values. |
| `float` | supported | `{ "kind": "float" }` | `Float` | `double precision` | Approximate numeric values. |
| `decimal` | supported | `{ "kind": "decimal" }` | `Decimal` | `numeric` | Money-like values should prefer `decimal`. |
| `boolean` | supported | `{ "kind": "boolean" }` | `Boolean` | `boolean` | `true` / `false`. |
| `uuid` | supported | `{ "kind": "uuid" }` | `String @db.Uuid` | `uuid` | `primary` implies generated UUID default. |
| `timestamp` | supported | `{ "kind": "timestamp" }` | `DateTime` | `timestamp with time zone` | Use for instants. |
| `datetime` | alias | canonicalized to `timestamp` | `DateTime` | `timestamp with time zone` | Formatter should rewrite to `timestamp`. |
| `date` | supported | `{ "kind": "date" }` | `DateTime` with date handling | `date` | Use for calendar dates. |
| `json` | supported | `{ "kind": "json" }` | `Json` | `jsonb` | No nested schema validation in V1. |
| `enum[...]` | supported | `{ "kind": "enum", "values": [...] }` | generated Prisma enum | enum or text with check constraint | Values are ordered and unique. |
| `ModelName` | supported as model reference | `{ "kind": "model_ref", "model_id": "model.ModelName" }` | relation field + FK | foreign key | Requires relation mapping. |
| `T[]` | limited/reserved | relation-only in restricted forms | relation list if inverse | no direct column | Scalar arrays and implicit many-to-many are unsupported in V1. |

### 8.4 String constraints

`string` and `text` support:

```arch
max <integer>
min <integer>
```

Examples:

```arch
username: string min 3 max 32 unique
bio: string max 280 optional
content: text max 5000
```

Validation rules:

```text
- max and min are valid only for string or text.
- min must be <= max.
- max must be positive.
- string without max is allowed but formatter may recommend max for API input fields.
```

### 8.5 Numeric constraints

V1 does not support numeric min/max field modifiers in model declarations. Numeric validation belongs in explicit policies or future schema constraints.

Invalid:

```arch
age: int min 0
```

Reason:

```text
ARCH-TYPE-003: min/max field modifiers are V1 string length constraints only.
```

### 8.6 UUID fields

Example:

```arch
id: uuid primary
```

Canonical behavior:

```text
primary: true
required: true
unique: true
indexed: true
immutable: true
default: uuid
```

IR field type:

```json
{ "kind": "uuid" }
```

Prisma mapping example:

```prisma
id String @id @default(uuid()) @db.Uuid
```

### 8.7 Timestamp fields

Examples:

```arch
created_at: timestamp default now immutable
updated_at: timestamp default now
```

`default now` compiles to:

```json
{ "kind": "now" }
```

V1 may generate Prisma `@updatedAt` for fields named `updated_at` when the compiler supports that convention, but `.arch` does not define automatic update semantics unless a future `auto_update` modifier is added. In V1, `updated_at` is a normal timestamp field unless target templates define an explicit convention.

### 8.8 Enum fields

Syntax:

```arch
visibility: enum["public", "private", "followers"] default "public" indexed
```

Rules:

```text
- Enum values must be string literals.
- Enum values must be unique.
- Enum values preserve declared order in IR.
- Default value, if present, must be one of the enum values.
```

IR mapping:

```json
{
  "id": "model.Post.field.visibility",
  "kind": "model_field",
  "name": "visibility",
  "model_id": "model.Post",
  "type": {
    "kind": "enum",
    "values": ["public", "private", "followers"]
  },
  "constraints": {
    "required": true,
    "unique": false,
    "primary": false,
    "indexed": true,
    "immutable": false,
    "default": "public"
  }
}
```

Prisma mapping example:

```prisma
enum PostVisibility {
  public
  private
  followers
}

model Post {
  visibility PostVisibility @default(public)
}
```

### 8.9 JSON fields

Syntax:

```arch
metadata: json optional
```

Rules:

```text
- V1 treats json as unstructured JSON.
- No nested JSON schema is supported in `.arch` V1.
- Generated validators should accept JSON-compatible values.
```

### 8.10 Array fields

V1 reserves `T[]` syntax but does not support scalar persisted arrays.

Invalid in V1:

```arch
tags: string[]
```

Reason:

```text
ARCH-V1-004: scalar array fields are reserved but unsupported in V1.
```

Relation arrays are allowed only for explicit inverse relation declarations:

```arch
posts: Post[] relation one_to_many via Post.author
```

This does not create a separate persisted array column. It compiles to relation metadata derived from `Post.author`.

Implicit many-to-many arrays are invalid:

```arch
followers: User[] relation many_to_many
```

Use an explicit join model instead:

```arch
model Follow {
  id: uuid primary
  follower: User required relation many_to_one
  following: User required relation many_to_one
  created_at: timestamp default now
}
```

---

## 9. Model Declarations

### 9.1 Basic syntax

```arch
model User {
  id: uuid primary
  email: string unique required
  username: string unique required
  bio: string max 280 optional
  created_at: timestamp default now immutable
}
```

A model declaration compiles to one `ModelIR` and one Prisma model in V1.

### 9.2 Model validation rules

```text
- Model names must be unique.
- Each model must contain at least one field.
- Each model must declare exactly one primary field.
- Field names must be unique within the model.
- Field declarations must compile to supported V1 field types.
- A field referencing a model must resolve to an existing model.
- Unsupported relation cardinalities are rejected.
```

### 9.3 Field declaration shape

```arch
<field_name>: <type> <modifier>*
```

Examples:

```arch
id: uuid primary
email: string unique required
bio: string max 280 optional
created_at: timestamp default now immutable
visibility: enum["public", "private", "followers"] default "public" indexed
author: User required relation many_to_one
```

### 9.4 Field modifiers

| Modifier | Applies to | Meaning | IR mapping |
|---|---|---|---|
| `required` | all fields | non-null / required input | `constraints.required = true` |
| `optional` | all non-primary fields | nullable or optional input | `constraints.required = false` |
| `primary` | scalar fields | primary key | `primary=true`, `unique=true`, `indexed=true`, `required=true` |
| `unique` | scalar fields | unique constraint | `constraints.unique = true` |
| `indexed` / `index` | scalar or relation fields | generated index | `constraints.indexed = true` |
| `immutable` | scalar fields | should not be updated after creation | `constraints.immutable = true` |
| `default <value>` | compatible fields | generated default | `constraints.default` |
| `max <n>` | string/text | maximum length | `constraints.max_length = n` |
| `min <n>` | string/text | minimum length | `constraints.min_length = n` |
| `relation <cardinality>` | model refs / inverse refs | relation cardinality | `RelationIR.cardinality` |
| `via <Model.field>` | inverse relation refs | source relation field | relation source metadata |
| `on_delete <action>` | relations | delete behavior | `RelationIR.on_delete` |

### 9.5 Defaults

Supported defaults:

| Syntax | Valid types | IR mapping |
|---|---|---|
| `default "value"` | string, text, enum | string scalar |
| `default 123` | int, bigint, float, decimal | number scalar |
| `default true` | boolean | boolean scalar |
| `default false` | boolean | boolean scalar |
| `default now` | timestamp, datetime, date | `{ "kind": "now" }` |
| `default uuid` | uuid | `{ "kind": "uuid" }` |

`primary` on a UUID field implies `default uuid` if no default is declared.

### 9.6 Unique constraints

Single-field uniqueness:

```arch
email: string unique required
```

Composite unique constraints are not supported in V1 source syntax. They may be added in a future `unique(...)` or `index(...) unique` grammar.

### 9.7 Indexes

V1 supports simple indexes through `indexed` on a field.

```arch
created_at: timestamp default now indexed
```

Optional named index syntax is reserved:

```arch
index posts_by_author_created_at(author, created_at)
```

Named index declarations are invalid in normal V1 apply. They are reserved for a future source feature with first-class IR support.

### 9.8 Timestamps

Recommended timestamp fields:

```arch
created_at: timestamp default now immutable
updated_at: timestamp default now
```

V1 does not automatically inject timestamp fields. They must be declared explicitly.

### 9.9 Model-to-IR mapping

Source:

```arch
model Post {
  id: uuid primary
  content: string max 5000
  visibility: enum["public", "private", "followers"] default "public"
}
```

IR fragments:

```json
{
  "id": "model.Post",
  "kind": "model",
  "name": "Post",
  "fields": [
    "model.Post.field.id",
    "model.Post.field.content",
    "model.Post.field.visibility"
  ],
  "relations": [],
  "indexes": []
}
```

```json
{
  "id": "model.Post.field.content",
  "kind": "model_field",
  "name": "content",
  "model_id": "model.Post",
  "type": { "kind": "string" },
  "constraints": {
    "required": true,
    "unique": false,
    "primary": false,
    "indexed": false,
    "immutable": false,
    "max_length": 5000
  }
}
```

---

## 10. Relation Declarations

### 10.1 V1 relation design

V1 supports these relation cardinalities:

```text
many_to_one
one_to_many
one_to_one
```

V1 rejects implicit many-to-many relations. Use an explicit join model.

Supported source forms are:

```text
- inline model-reference fields, such as `author: User relation many_to_one`
- inverse relation views, such as `posts: Post[] relation one_to_many via Post.author`
- explicit `relation Name { ... }` blocks that point at an existing model-reference field
```

All supported relation source forms compile to `RelationIR`. Only inline model-reference fields create a persisted generated foreign key.

### 10.2 Inline many-to-one relation

The most common relation form is a model reference field:

```arch
model Post {
  id: uuid primary
  author: User required relation many_to_one on_delete restrict
  content: string max 5000
}
```

This creates:

```text
- FieldIR model.Post.field.author with type model_ref -> model.User
- RelationIR relation.Post.author.User
- generated foreign key author_id
```

IR relation fragment:

```json
{
  "id": "relation.Post.author.User",
  "kind": "relation",
  "name": "author",
  "from_model_id": "model.Post",
  "to_model_id": "model.User",
  "field_id": "model.Post.field.author",
  "cardinality": "many_to_one",
  "required": true,
  "foreign_key": {
    "field_name": "author_id",
    "generated": true
  },
  "on_delete": "restrict"
}
```

### 10.3 Default relation cardinality

A model reference without `relation` defaults to `many_to_one`:

```arch
author: User required
```

Canonical form:

```arch
author: User required relation many_to_one on_delete restrict
```

The formatter may insert the explicit `relation many_to_one` form in strict mode.

### 10.4 Optional relation

```arch
profile: Profile optional relation one_to_one on_delete set_null
```

Rules:

```text
- optional relation may use on_delete set_null.
- required relation may not use on_delete set_null.
```

### 10.5 Inverse one-to-many relation

Source:

```arch
model User {
  id: uuid primary
  posts: Post[] relation one_to_many via Post.author
}
```

This is an inverse relation view. It does not create a new persisted column.

Rules:

```text
- The array element type must be a model.
- The relation cardinality must be one_to_many.
- via must reference an existing many_to_one field on the target model.
- The via field must point back to the declaring model.
```

Example validation:

```text
User.posts via Post.author is valid only if Post.author has type User.
```

### 10.6 One-to-one relation

```arch
model UserProfile {
  id: uuid primary
  user: User required relation one_to_one on_delete cascade
  display_name: string max 80
}
```

V1 maps one-to-one relations to a unique foreign key.

### 10.7 Explicit relation block

An explicit relation block may be used when teams prefer relation metadata separated from the field line:

```arch
model Post {
  id: uuid primary
  author: User required

  relation PostAuthor {
    from: Post
    to: User
    field: Post.author
    cardinality: many_to_one
    required: true
    on_delete: restrict
  }
}
```

Rules:

```text
- The block must appear inside the model named by `from`.
- `field` must reference an existing field on `from`.
- The referenced field type must be a model reference to `to`.
- `cardinality` must be many_to_one or one_to_one.
- `one_to_many` explicit relation blocks are reserved and invalid in normal V1; inverse one-to-many relations must use the inline `Model[] relation one_to_many via Model.field` form.
- The block compiles to the same `RelationIR` as the equivalent inline relation.
- Conflicting inline and block relation metadata are validation errors.
```

### 10.8 Many-to-many is deferred

Invalid:

```arch
model User {
  id: uuid primary
  followers: User[] relation many_to_many
}
```

Error:

```text
Error ARCH-REL-004:
Implicit many_to_many relations are not supported in V1.
Declare an explicit join model instead.
```

Use:

```arch
model Follow {
  id: uuid primary
  follower: User required relation many_to_one
  following: User required relation many_to_one
  created_at: timestamp default now
}
```

### 10.9 Relation delete actions

Supported `on_delete` values:

| Syntax | Meaning |
|---|---|
| `restrict` | prevent deletion when related records exist |
| `cascade` | delete dependent records |
| `set_null` | set FK to null; requires optional relation |
| `no_action` | defer behavior to database default |

Default:

```text
on_delete restrict
```

---

## 11. Target Declaration

### 11.1 Syntax

```arch
target {
  language: typescript
  runtime: node.fastify
  database: postgres
  orm: prisma
  cache: redis
  auth: oauth.github
  test_framework: vitest
  local_runtime: docker_compose
  package_manager: pnpm
}
```

### 11.2 Required and default target fields

V1 requires:

```text
runtime
database
orm
cache
auth
```

V1 defaults if omitted:

```text
language: typescript
test_framework: vitest
local_runtime: docker_compose
package_manager: pnpm
```

`arch init` should emit `cache: redis` by default. A project may opt out of generated cache artifacts by declaring `cache: none`; `cache:none` and `cache: none` are equivalent source forms. `cache` has no hidden semantic default during validation: the source or the initialized template must choose `redis` or `none`.

A formatter may emit defaults explicitly.

### 11.3 Allowed V1 values

| Property | Allowed values |
|---|---|
| `language` | `typescript` |
| `runtime` | `node.fastify` |
| `database` | `postgres` |
| `orm` | `prisma` |
| `cache` | `redis`, `none` |
| `auth` | `oauth.github`, `none`, `custom` |
| `test_framework` | `vitest` |
| `local_runtime` | `docker_compose` |
| `package_manager` | `pnpm` |

Unsupported target values are errors, not hints.

### 11.4 Target-to-IR mapping

Source:

```arch
target {
  runtime: node.fastify
  database: postgres
  orm: prisma
  cache: redis
  auth: oauth.github
}
```

IR:

```json
{
  "id": "target.primary",
  "kind": "target",
  "name": "primary",
  "language": "typescript",
  "runtime": "node.fastify",
  "database": "postgres",
  "orm": "prisma",
  "cache": "redis",
  "auth": "oauth.github",
  "test_framework": "vitest",
  "local_runtime": "docker_compose",
  "package_manager": "pnpm"
}
```

---

## 12. Workflow Declarations

### 12.1 Workflow purpose

A workflow describes backend behavior triggered by an API route. It contains:

```text
- exactly one trigger
- optional input/output model references
- ordered steps
- optional policies
- guarantees
- test requirements
```

### 12.2 Basic syntax

```arch
workflow CreatePost {
  trigger: api.POST("/posts")
  input: Post
  output: Post

  steps {
    validate input as Post
    moderate Post.content using LLMModeratorGuardrail
    sanitize Post.content as html_safe
    insert Post
    notify mentioned_users via PushProvider best_effort
    return Post
  }

  guarantees {
    no_unsanitized_html_persisted
    notification_failure_does_not_rollback_post
    post_creation_p95_latency <= 200ms
  }

  tests {
    generate integration_tests for workflow.CreatePost
  }
}
```

### 12.3 Workflow validation rules

```text
- Workflow names must be unique.
- A workflow must have exactly one trigger.
- V1 generated workflows must use API triggers.
- API method/path pairs must be unique across workflows.
- A workflow must have at least one step.
- Step order is semantic and preserved in IR.
- Every referenced model, field, integration, custom extension, policy, and guarantee must resolve.
- Unsupported step forms are rejected with V1 errors.
```

### 12.4 Step ordering

Steps execute in source order.

Reordering steps changes semantics and produces a `workflow_step_reordered` IR diff.

This matters for guarantees such as:

```arch
moderation_precedes_persistence
notification_failure_does_not_rollback_post
```

### 12.5 Workflow input and output

`input` and `output` are optional V1 metadata:

```arch
input: Post
output: Post
```

They compile to `WorkflowIR.input_model_id` and `WorkflowIR.output_model_id` when they reference models.

If omitted, the compiler may infer input/output from steps for generated route scaffolding, but inferred values must be explicit in IR.

### 12.6 Error behavior

Workflow-level default:

```arch
on_error: rollback_workflow
```

Supported failure behavior values:

```text
rollback_workflow
continue
record_error
retry_then_continue
retry_then_fail
```

Step-level modifiers override workflow-level defaults where valid:

```arch
notify mentioned_users via PushProvider best_effort
notify mentioned_users via PushProvider retry 3 then continue
```

---

## 13. Workflow Step Vocabulary

### 13.1 Step design

Workflow steps are not arbitrary natural language. They are line-oriented declarations from a bounded vocabulary.

Each supported step compiles to `StepIR` with:

```text
- stable step ID
- ordered position
- operation type
- read/write references
- integration references
- failure behavior
- transaction boundary
- source location
```

### 13.2 Supported V1 step operations

| Source form | IR operation type | V1 status |
|---|---|---:|
| `validate input [as Model]` | `validate_input` | supported |
| `moderate Model.field using Integration` | `moderate_content` | supported |
| `sanitize Model.field as html_safe` | `sanitize_field` | supported |
| `insert Model` | `insert_model` | supported |
| `update CacheName for Path` | `update_cache` | supported when target cache is Redis |
| `notify Audience via Integration` | `notify_users` | supported |
| `call custom Name [with ...]` | `call_custom` | supported |
| `return [Expr]` | `return_response` | supported |
| `query Model ...` | none | reserved, unsupported in V1 |
| `update Model ...` | none | reserved, unsupported in V1 except cache update form |
| `delete Model ...` | none | reserved, unsupported in V1 |
| `enqueue ...` | none | reserved, unsupported in V1 |
| `if ...` | none | reserved, unsupported in V1 |
| `call integration ...` | none | reserved, unsupported unless canonicalized to `moderate` or `notify` |

### 13.3 `validate input`

Syntax:

```arch
validate input
validate input as Post
```

Meaning:

```text
Validate request/input payload against the inferred or declared workflow input model.
```

IR mapping:

```json
{
  "operation": {
    "type": "validate_input",
    "model_id": "model.Post",
    "parameters": {}
  },
  "failure_behavior": "rollback_workflow",
  "transaction_boundary": "none"
}
```

Rules:

```text
- If `as Model` is provided, Model must exist.
- If omitted, compiler infers from workflow input or first insert step.
- Validation failure returns generated API error behavior.
```

### 13.4 `moderate`

Syntax:

```arch
moderate Post.content using LLMModeratorGuardrail
```

Meaning:

```text
Run content moderation on a string/text field using an llm_moderation integration.
```

IR mapping:

```json
{
  "operation": {
    "type": "moderate_content",
    "field_id": "model.Post.field.content",
    "integration_id": "integration.LLMModeratorGuardrail",
    "parameters": {}
  },
  "reads": ["model.Post.field.content"],
  "uses_integrations": ["integration.LLMModeratorGuardrail"]
}
```

Rules:

```text
- Field must exist and be string/text.
- Integration must exist and have kind llm_moderation.
- Default failure behavior is rollback_workflow.
- Moderation before persistence can support moderation guarantees.
```

### 13.5 `sanitize`

Syntax:

```arch
sanitize Post.content as html_safe
```

Supported sanitizer modes:

```text
html_safe
plain_text
trim
lowercase
```

Only `html_safe` has built-in guarantee mappings in V1. Other modes may generate deterministic transforms but do not automatically satisfy safety guarantees.

IR mapping:

```json
{
  "operation": {
    "type": "sanitize_field",
    "field_id": "model.Post.field.content",
    "parameters": {
      "mode": "html_safe"
    }
  },
  "reads": ["model.Post.field.content"],
  "writes": ["model.Post.field.content"]
}
```

Rules:

```text
- Field must exist and be string/text.
- Sanitization should occur before insert/update steps that persist the field.
```

### 13.6 `insert`

Syntax:

```arch
insert Post
```

Meaning:

```text
Persist a new record for the model.
```

IR mapping:

```json
{
  "operation": {
    "type": "insert_model",
    "model_id": "model.Post",
    "parameters": {}
  },
  "writes": ["model.Post"],
  "failure_behavior": "rollback_workflow",
  "transaction_boundary": "inside_transaction"
}
```

Rules:

```text
- Model must exist.
- Generated implementation uses Prisma create.
- Required fields without defaults must be validated or otherwise populated before insert.
```

### 13.7 `update CacheName for Path`

Syntax:

```arch
update FeedCache for author.followers
```

Meaning:

```text
Update a generated Redis-backed cache artifact.
```

IR mapping:

```json
{
  "operation": {
    "type": "update_cache",
    "target": "model.Post",
    "parameters": {
      "cache_key": "FeedCache",
      "audience": "author.followers"
    }
  },
  "failure_behavior": "record_error",
  "transaction_boundary": "outside_transaction"
}
```

Rules:

```text
- target.cache must be redis.
- CacheName is a generated cache key namespace, not an integration name.
- Cache update failures default to record_error.
```

Invalid when cache is none:

```arch
target { cache: none }
workflow X { steps { update FeedCache for user } }
```

### 13.8 `notify`

Syntax:

```arch
notify mentioned_users via PushProvider
notify mentioned_users via PushProvider best_effort
notify mentioned_users via PushProvider retry 3 then continue
```

Meaning:

```text
Send a notification to an audience through a push, email, or custom integration.
```

IR mapping:

```json
{
  "operation": {
    "type": "notify_users",
    "integration_id": "integration.PushProvider",
    "parameters": {
      "audience": "mentioned_users"
    }
  },
  "uses_integrations": ["integration.PushProvider"],
  "failure_behavior": "continue",
  "transaction_boundary": "outside_transaction"
}
```

Rules:

```text
- Integration must exist.
- Integration kind must be push, email, or custom.
- If integration.required is false, default failure behavior is continue.
- If integration.required is true, default failure behavior is rollback_workflow unless overridden by an explicit guarantee or step modifier.
- Notification steps after insert default to outside_transaction.
```

### 13.9 `call custom`

Syntax:

```arch
call custom PostRankingStrategy
call custom PostRankingStrategy with Post
```

Meaning:

```text
Invoke a human-owned extension point.
```

IR mapping:

```json
{
  "operation": {
    "type": "call_custom",
    "custom_extension_id": "custom_extension.PostRankingStrategy",
    "parameters": {
      "arguments": ["model.Post"]
    }
  },
  "failure_behavior": "rollback_workflow"
}
```

Rules:

```text
- Custom extension must be declared with `custom Name { ... }`.
- Arch may create a stub file if missing.
- Arch must not overwrite a completed human-owned implementation.
```

### 13.10 `return`

Syntax:

```arch
return Post
return created_post
return
```

Meaning:

```text
Define the response boundary for generated route/workflow code.
```

IR mapping:

```json
{
  "operation": {
    "type": "return_response",
    "target": "model.Post",
    "parameters": {}
  },
  "transaction_boundary": "none"
}
```

Rules:

```text
- Return target must be resolvable or omitted.
- If omitted, generated route may return the workflow output model or standard status response.
```

### 13.11 Reserved unsupported step examples

These parse as recognizable forms but fail semantic validation in normal V1 apply:

```arch
query Post where author = input.user
update Post set visibility = "private"
delete Post where id = input.id
enqueue SendDigest
if user.is_admin { insert Post }
call integration FraudProvider with Payment
```

Error example:

```text
Error ARCH-WF-009:
Step operation `query` is reserved but unsupported in V1 generated workflows.
Use a custom extension point or wait for a future workflow operation.
```

---

## 14. Trigger Declarations

### 14.1 V1 supported triggers

V1 generated workflows support API triggers only:

```text
api.GET
api.POST
api.PUT
api.PATCH
api.DELETE
```

`manual` and `schedule` syntax is reserved but unsupported in V1 generated code.

### 14.2 API trigger syntax

```arch
trigger: api.POST("/posts")
trigger: api.GET("/posts/:id") auth optional
trigger: api.DELETE("/posts/:id") auth required
```

### 14.3 Auth modifier

`auth required` and `auth optional` override the target auth default for a trigger.

If omitted:

```text
- auth is required when target.auth is not none.
- auth is false when target.auth is none.
```

### 14.4 API trigger rules

```text
- Path must start with `/`.
- Path must not include query string.
- Method/path pair must be unique across workflows.
- Dynamic parameters use Fastify-compatible `:name` source syntax.
```

### 14.5 Trigger-to-IR mapping

Source:

```arch
trigger: api.POST("/posts")
```

IR:

```json
{
  "id": "workflow.CreatePost.trigger.api_post_posts",
  "kind": "trigger",
  "name": "api_post_posts",
  "workflow_id": "workflow.CreatePost",
  "trigger_kind": "api",
  "api": {
    "method": "POST",
    "path": "/posts",
    "auth_required": true
  }
}
```

### 14.6 Reserved unsupported triggers

Syntax:

```arch
trigger: manual("rebuild-feed")
trigger: schedule.cron("0 * * * *")
```

V1 error:

```text
Error ARCH-TRIG-002:
Trigger kind `schedule` is reserved but unsupported in V1.
V1 generated workflows support API triggers only.
```

---

## 15. Integration Declarations

### 15.1 Purpose

An integration declares an external service, provider, or boundary used by workflows. Integrations are typed so the compiler can validate workflow steps and generate stubs, config schemas, tests, and failure behavior.

### 15.2 Syntax

```arch
integration PushProvider {
  kind: push
  provider: firebase
  required: false
  failure_policy: best_effort
}

integration LLMModeratorGuardrail {
  kind: llm_moderation
  provider: custom
  required: true
  failure_policy: fail_workflow
}
```

### 15.3 Required fields

`kind` is required.

`required` is required unless inferable from `failure_policy`:

```text
failure_policy: fail_workflow -> required true
failure_policy: best_effort -> required false
```

For clarity, V1 formatters should emit both.

### 15.4 Supported V1 integration kinds

| Kind | Typical steps | Generated support |
|---|---|---|
| `llm_moderation` | `moderate` | typed interface and stub |
| `push` | `notify` | typed interface and stub |
| `email` | `notify` | typed interface and stub |
| `cache` | cache-specific custom behavior | limited; Redis target is preferred |
| `auth` | auth policies and route guards | stub or provider template |
| `custom` | custom workflow/integration boundary | typed interface and stub |

### 15.5 Failure policies

| Syntax | Meaning | IR mapping |
|---|---|---|
| `fail_workflow` | failure fails workflow | `failure_policy = fail_workflow` |
| `best_effort` | failure does not fail workflow | `failure_policy = best_effort` |
| `retry` | retry according to policy | `failure_policy = retry` |
| `custom` | custom implementation controls behavior | `failure_policy = custom` |

### 15.6 Config schema

Config values are schemas, not secrets.

```arch
integration PushProvider {
  kind: push
  provider: firebase
  required: false
  failure_policy: best_effort

  config {
    project_id: string required
    api_key: secret required
  }
}
```

Rules:

```text
- `.arch` must not contain secret values.
- Config schema compiles to integration config metadata.
- Runtime secret loading is generated from environment variables or custom config.
```

### 15.7 Integration-to-IR mapping

Source:

```arch
integration PushProvider {
  kind: push
  required: false
}
```

IR:

```json
{
  "id": "integration.PushProvider",
  "kind": "integration",
  "name": "PushProvider",
  "integration_kind": "push",
  "required": false,
  "provider": "custom",
  "config_schema": [],
  "failure_policy": "best_effort"
}
```

---

## 16. Policy Declarations

### 16.1 Purpose

Policies define operational, authorization, retry, transaction, cache, rate-limit, or custom constraints that can be enforced by generated code, runtime assertions, or manual verification.

Policies are not comments. They compile to `PolicyIR`.

### 16.2 Named policy syntax

```arch
policy RequireAuthForApi {
  kind: auth
  scope: all api routes
  enforcement: generated_code

  rules {
    auth.required == true
  }
}
```

### 16.3 Short policy syntax

Short policy blocks are ergonomic aliases for common V1 policies:

```arch
policies {
  require auth for all api routes
  require audit_log for llm decisions
}
```

The compiler expands short forms to named `PolicyIR` objects with generated stable names.

V1 short forms are limited to:

| Short form | Expansion |
|---|---|
| `require auth for all api routes` | `PolicyIR` with `policy_kind: auth`, scope `target.primary`, generated route enforcement |
| `require audit_log for llm decisions` | `PolicyIR` with `policy_kind: custom`, scoped to LLM moderation integrations and moderation steps, manual or custom enforcement unless a supported audit extension is declared |
| `use Name` | reference an existing named policy in the current scope; does not create a new `PolicyIR` |

### 16.4 Supported V1 policy kinds

```text
auth
authorization
retry
transaction
idempotency
cache
rate_limit
custom
```

### 16.5 Policy scopes

Supported scope forms:

```arch
scope: system
scope: all api routes
scope: workflow.CreatePost
scope: workflow.CreatePost.step.notify_mentioned_users
scope: model.Post
scope: model.Post.field.content
```

A policy scope must resolve to one or more IR entities.

### 16.6 Policy rule language

Policy rules are simple comparisons:

```arch
auth.required == true
latency.p95 <= 200ms
retry.max_attempts == 3
rate_limit.requests_per_minute <= 60
```

Supported operators:

```text
== != <= >= < > in
```

Rule values must be typed literals or arrays of typed literals.

### 16.7 Policy enforcement modes

| Mode | Meaning |
|---|---|
| `generated_code` | compiler should generate enforcement code |
| `runtime_assertion` | compiler should generate runtime checks/assertions |
| `manual` | reported as manual verification requirement |
| `custom` | delegated to declared custom extension |

### 16.8 Policy-to-IR mapping

Source:

```arch
policy CreatePostNotificationRetry {
  kind: retry
  scope: workflow.CreatePost.step.notify_mentioned_users
  enforcement: generated_code

  rules {
    retry.max_attempts == 3
  }
}
```

IR:

```json
{
  "id": "policy.CreatePostNotificationRetry",
  "kind": "policy",
  "name": "CreatePostNotificationRetry",
  "policy_kind": "retry",
  "scope": ["workflow.CreatePost.step.notify_mentioned_users"],
  "rules": [
    {
      "field": "retry.max_attempts",
      "operator": "equals",
      "value": 3
    }
  ],
  "enforcement": "generated_code"
}
```

### 16.9 Policy conflicts

Policies must not conflict with guarantees.

Example conflict:

```arch
policy NotifyInsideTransaction {
  kind: transaction
  scope: workflow.CreatePost.step.notify_mentioned_users
  enforcement: generated_code

  rules {
    transaction.boundary == inside_transaction
  }
}

workflow CreatePost {
  guarantees {
    notification_failure_does_not_rollback_post
  }
}
```

This conflicts because notification failure could roll back post insertion if notification runs inside the transaction.

---

## 17. Guarantee Declarations

### 17.1 Purpose

Guarantees are first-class behavioral contracts. They drive generated tests, static checks, runtime assertions, verification coverage, drift detection, and repair planning.

A guarantee must compile to structured IR. It must not rely on an LLM to infer behavior from free-form text.

### 17.2 Short-form guarantees

Short-form guarantees are allowed inside `guarantees` blocks:

```arch
guarantees {
  no_unsanitized_html_persisted
  notification_failure_does_not_rollback_post
  post_creation_p95_latency <= 200ms
}
```

Short forms compile only if they match a supported V1 guarantee pattern or reference a declared long-form guarantee by name.

Unknown short-form identifiers are errors in normal V1 apply.

### 17.3 Long-form guarantees

Long-form guarantees provide structured scope, category, predicate, and verification strategy:

```arch
guarantee NotificationFailureNonBlocking {
  scope: workflow.CreatePost, integration.PushProvider
  category: transactional_behavior
  description: "Push notification failure must not rollback persisted post creation."
  assert: failure(integration.PushProvider) does_not rollback insert(Post)
  verify: integration_test
  verifiability: testable
}
```

Rules:

```text
- A long-form guarantee must declare `category`, `assert`, `verify`, and `verifiability`.
- `scope` is required unless the guarantee is declared inside a workflow, where the workflow scope is inherited.
- A long-form guarantee with `verifiability: unsupported` is rejected in normal V1 apply.
- A custom predicate is not executable by default; it must be paired with `manual`, `partially_verifiable`, or `custom` verification.
```

### 17.4 Local workflow guarantee scope

Guarantees declared inside a workflow inherit that workflow scope unless an explicit `scope` is provided.

```arch
workflow CreatePost {
  guarantees {
    no_unsanitized_html_persisted
  }
}
```

The short form above scopes to `workflow.CreatePost`.

### 17.5 Supported V1 guarantee categories

```text
data_integrity
transactional_behavior
security_safety
moderation
latency
integration_failure
authorization
custom
```

### 17.6 Supported V1 short-form guarantee patterns

| Short form | Category | Predicate | Default verification |
|---|---|---|---|
| `no_unsanitized_html_persisted` | `security_safety` | persisted sanitized field satisfies `html_safe` | integration test + optional runtime assertion |
| `<workflow>_p95_latency <= <duration>` | `latency` | p95 latency threshold | load-test scaffold, partial |
| `notification_failure_does_not_rollback_<model>` | `transactional_behavior` | integration failure does not rollback model insert | integration test |
| `every_llm_decision_has_audit_log` | `security_safety` / `custom` | LLM moderation calls write audit logs | static check or manual unless an audit policy/custom extension is declared |
| `moderation_precedes_persistence` | `moderation` | moderation step before insert | static check + integration test |

Pattern matching is contextual. For example, `notification_failure_does_not_rollback_post` requires a workflow with an insert step for `Post` and a later notification step using an integration.

If the compiler cannot infer the referenced model, integration, or steps, it emits an error requiring long-form syntax.

### 17.7 Predicate syntax

Supported structured predicates:

```arch
assert: persisted(Post.content) satisfies html_safe
assert: failure(integration.PushProvider) does_not rollback insert(Post)
assert: latency.p95(workflow.CreatePost) <= 200ms
assert: step(workflow.CreatePost.step.moderate_post_content) before step(workflow.CreatePost.step.insert_post)
assert: auth.required(workflow.CreatePost.trigger.api_post_posts)
```

Custom predicates are allowed only with manual, partial, or custom verification:

```arch
assert: custom("domain-specific invariant") references [workflow.CreatePost, model.Post]
verify: manual_review
verifiability: manual
```

### 17.8 Verification strategies

```text
unit_test
integration_test
contract_test
static_check
runtime_assertion
load_test_scaffold
manual_review
custom
```

### 17.9 Verifiability statuses

```text
testable
partially_verifiable
runtime_assertable
manual
unsupported
```

Rules:

```text
- testable guarantees must produce at least one TestIR.
- partially_verifiable guarantees must include limitations in IR.
- runtime_assertable guarantees must produce runtime assertion metadata.
- manual guarantees must appear in plan and verification reports.
- unsupported guarantees are rejected in normal V1 apply.
- latency guarantees are partially verifiable in V1 and must use `verifiability: partially_verifiable` with `verify: load_test_scaffold`; local checks do not prove production latency.
```

### 17.10 Guarantee-to-IR mapping: HTML safety

Source:

```arch
workflow CreatePost {
  steps {
    sanitize Post.content as html_safe
    insert Post
  }

  guarantees {
    no_unsanitized_html_persisted
  }
}
```

IR:

```json
{
  "id": "guarantee.no_unsanitized_html_persisted",
  "kind": "guarantee",
  "name": "no_unsanitized_html_persisted",
  "category": "security_safety",
  "description": "Post content persisted by CreatePost must be sanitized for HTML safety.",
  "formal_predicate": {
    "type": "for_all_persisted_records",
    "entity_id": "model.Post",
    "field_id": "model.Post.field.content",
    "predicate": "is_html_safe"
  },
  "scope": [
    "workflow.CreatePost",
    "model.Post.field.content",
    "workflow.CreatePost.step.sanitize_post_content",
    "workflow.CreatePost.step.insert_post"
  ],
  "verifiability": "testable",
  "verification": {
    "strategy": "integration_test",
    "expected_tests": ["test.create_post_no_unsanitized_html_persisted"],
    "limitations": []
  }
}
```

### 17.11 Guarantee-to-IR mapping: latency

Source:

```arch
guarantees {
  post_creation_p95_latency <= 200ms
}
```

IR:

```json
{
  "id": "guarantee.post_creation_p95_latency",
  "kind": "guarantee",
  "name": "post_creation_p95_latency",
  "category": "latency",
  "formal_predicate": {
    "type": "percentile_latency_lte",
    "workflow_id": "workflow.CreatePost",
    "percentile": 95,
    "threshold": { "value": 200, "unit": "ms" }
  },
  "scope": ["workflow.CreatePost"],
  "verifiability": "partially_verifiable",
  "verification": {
    "strategy": "load_test_scaffold",
    "expected_tests": ["test.create_post_p95_latency_scaffold"],
    "limitations": [
      "Local tests cannot prove production p95 latency."
    ]
  }
}
```

### 17.12 Unknown guarantees

Invalid:

```arch
guarantees {
  users_should_probably_like_the_feed
}
```

Error:

```text
Error ARCH-GUAR-001:
Unknown short-form guarantee `users_should_probably_like_the_feed`.
Use a supported guarantee pattern or declare a long-form guarantee with category, scope, assert, and verify fields.
```

---

## 18. Test Declarations

### 18.1 Test design

Guarantees imply tests where possible. Explicit `tests` blocks add test-generation requirements or register custom tests.

Tests compile to `TestIR` and verification metadata.

### 18.2 Short-form test syntax

```arch
tests {
  generate integration_tests for workflow.CreatePost
  generate unit_tests for model.Post
  verify guarantee no_unsanitized_html_persisted with integration
  include custom "tests/custom/postRanking.test.ts"
}
```

### 18.3 Long-form test syntax

```arch
test CreatePostHtmlSafety {
  kind: integration
  scope: workflow.CreatePost, guarantee.no_unsanitized_html_persisted
  guarantee: no_unsanitized_html_persisted
  path: "tests/generated/createPost.htmlSafety.test.ts"
  generated: true
}
```

### 18.4 Supported V1 test kinds

| Source | IR `test_kind` | Meaning |
|---|---|---|
| `unit` / `unit_tests` | `unit` | generated unit tests |
| `integration` / `integration_tests` | `integration` | generated integration tests |
| `contract` / `contract_tests` | `contract` | API contract tests |
| `static` / `static_checks` | `static` | static validation checks |
| `load_scaffold` / `load_test_scaffold` | `load_scaffold` | partial latency/load scaffold |

`property_tests` is reserved but unsupported in V1.

### 18.5 Test inference from guarantees

A `testable` guarantee automatically creates generated test expectations.

Example:

```arch
guarantees {
  notification_failure_does_not_rollback_post
}
```

May generate:

```text
tests/generated/createPost.notificationFailure.test.ts
```

and `TestIR`:

```json
{
  "id": "test.create_post_notification_failure_does_not_rollback",
  "kind": "test",
  "test_kind": "integration",
  "framework": "vitest",
  "path": "tests/generated/createPost.notificationFailure.test.ts",
  "scope": [
    "workflow.CreatePost",
    "guarantee.notification_failure_does_not_rollback_post"
  ],
  "guarantee_id": "guarantee.notification_failure_does_not_rollback_post",
  "generated": true
}
```

### 18.6 Custom tests

Custom test inclusion:

```arch
tests {
  include custom "tests/custom/postRanking.test.ts"
}
```

Rules:

```text
- Path must be repository-relative.
- Custom tests are human-owned.
- Arch must not overwrite them.
- They may be included in verification commands.
```

---

## 19. Custom Extension Points

### 19.1 Purpose

Custom extension points preserve human-owned implementation logic while allowing generated workflows to call it through typed boundaries.

Arch should generate stubs and calls into custom code. It should not overwrite completed custom implementations.

### 19.2 Syntax

```arch
custom PostRankingStrategy {
  kind: function
  input: Post
  output: decimal
  file: "src/custom/postRankingStrategy.ts"
  export: "postRankingStrategy"
}
```

Workflow usage:

```arch
workflow RankPost {
  trigger: api.POST("/posts/:id/rank")

  steps {
    validate input as Post
    call custom PostRankingStrategy with Post
    return Post
  }
}
```

### 19.3 Supported custom kinds

| Kind | V1 behavior |
|---|---|
| `function` | supported as a callable `call custom` workflow step |
| `workflow_step` | supported as a callable `call custom` workflow step |
| `policy` | supported only when referenced by a `policy` with `enforcement: custom` |
| `test_generator` | reserved; rejected in normal V1 unless a future custom test-generator IR contract is added |

### 19.4 Custom declaration rules

```text
- Custom names must be unique.
- file is required.
- file must be repository-relative.
- file should be under src/custom/ for implementation extensions.
- input and output type references must be scalar types, existing models, or supported qualified references.
- Arch may create the file if missing.
- After a human edits the file, ownership policy is create_only or read_only.
- Generated code may call a custom extension only through the declared file/export/type contract.
- Agents may receive bounded patch tasks for generated call sites, but must not infer or rewrite custom implementation semantics from prose.
```

### 19.5 Custom extension IR mapping

V1 source-level `custom` declarations compile into:

```text
- CustomExtensionIR
- ArtifactIR for the custom stub path
- OwnershipIR with ownership_kind = extension_point
- workflow StepIR with operation.type = call_custom when used
```

An unused `custom` declaration still creates extension-point artifact and ownership intent. It does not create executable workflow behavior until referenced by a `call custom` step or custom policy enforcement hook.

Example `CustomExtensionIR`:

```json
{
  "id": "custom_extension.PostRankingStrategy",
  "kind": "custom_extension",
  "name": "PostRankingStrategy",
  "extension_kind": "function",
  "input_types": [{ "kind": "model_ref", "model_id": "model.Post" }],
  "output_type": { "kind": "decimal" },
  "file": "src/custom/postRankingStrategy.ts",
  "export_name": "postRankingStrategy",
  "artifact_id": "artifact.src_custom_postRankingStrategy_ts",
  "ownership_id": "ownership.src_custom_postRankingStrategy_ts",
  "aliases": [],
  "source_id": "source.backend_arch.custom.PostRankingStrategy"
}
```

Example `StepIR`:

```json
{
  "id": "workflow.RankPost.step.call_custom_post_ranking_strategy",
  "kind": "workflow_step",
  "name": "call_custom_post_ranking_strategy",
  "workflow_id": "workflow.RankPost",
  "order": 2,
  "operation": {
    "type": "call_custom",
    "custom_extension_id": "custom_extension.PostRankingStrategy",
    "parameters": {
      "arguments": ["model.Post"]
    }
  },
  "failure_behavior": "rollback_workflow",
  "transaction_boundary": "none"
}
```

Example `OwnershipIR`:

```json
{
  "id": "ownership.src_custom_postRankingStrategy_ts",
  "kind": "ownership",
  "path": "src/custom/postRankingStrategy.ts",
  "owner": "human",
  "ownership_kind": "extension_point",
  "update_policy": "create_only",
  "entity_ids": ["workflow.RankPost.step.call_custom_post_ranking_strategy"]
}
```

---

## 20. Canonicalization Rules

### 20.1 General canonicalization

The compiler must canonicalize source before diffing or generation.

Rules:

```text
- Expand omitted target defaults.
- Expand implied field constraints.
- Resolve bare references to fully qualified IR entity IDs.
- Normalize datetime to timestamp.
- Normalize index to indexed.
- Normalize path separators in file paths to POSIX `/`.
- Normalize durations to typed duration objects.
- Preserve workflow step order.
- Preserve enum value order.
- Sort unordered IR entity collections by ID.
- Remove comments from semantic representation.
```

### 20.2 Stable entity IDs

Canonical ID patterns:

| Source construct | IR ID pattern | Example |
|---|---|---|
| system | `system.<SystemName>` | `system.SocialFeed` |
| target | `target.primary` | `target.primary` |
| model | `model.<ModelName>` | `model.Post` |
| field | `model.<ModelName>.field.<field_name>` | `model.Post.field.content` |
| relation | `relation.<FromModel>.<relation_name>.<ToModel>` | `relation.Post.author.User` |
| workflow | `workflow.<WorkflowName>` | `workflow.CreatePost` |
| trigger | `workflow.<WorkflowName>.trigger.<normalized_trigger>` | `workflow.CreatePost.trigger.api_post_posts` |
| step | `workflow.<WorkflowName>.step.<normalized_step_name>` | `workflow.CreatePost.step.sanitize_post_content` |
| integration | `integration.<IntegrationName>` | `integration.PushProvider` |
| policy | `policy.<PolicyName>` | `policy.RequireAuthForApi` |
| guarantee | `guarantee.<guarantee_name>` | `guarantee.no_unsanitized_html_persisted` |
| test | `test.<test_name>` | `test.create_post_html_safety` |

### 20.3 Step name generation

Step IDs are generated from operation type and target.

Examples:

| Step source | Step name |
|---|---|
| `validate input as Post` | `validate_input` |
| `moderate Post.content using LLMModeratorGuardrail` | `moderate_post_content` |
| `sanitize Post.content as html_safe` | `sanitize_post_content` |
| `insert Post` | `insert_post` |
| `notify mentioned_users via PushProvider` | `notify_mentioned_users` |
| `call custom PostRankingStrategy` | `call_custom_post_ranking_strategy` |

If two steps would produce the same name, the compiler appends a deterministic suffix:

```text
sanitize_post_content
sanitize_post_content_2
```

The formatter should encourage explicit long-form step aliases in a future version. V1 does not support user-specified step IDs.

### 20.4 Source locations

Every IR entity derived from source must include source location metadata:

```text
file
start line/column/offset
end line/column/offset
source hash
```

Source locations enable useful errors and traceability from generated artifacts back to `.arch` declarations.

---

## 21. `.arch` to IR Compilation Rules

### 21.1 Compilation phases

A V1 compiler should implement the canonical synchronization pipeline in this order:

```text
1. Parser.
2. AST.
3. Draft semantic model / draft IR.
4. Semantic validation.
5. Canonical IR.
6. IR schema validation.
7. IR snapshot store.
8. Typed diff.
9. Dependency graph.
10. Sync plan.
11. Deterministic templates / constrained agents.
12. Verification.
13. Metadata promotion.
```

The source-to-IR portion of that pipeline contains these deterministic substeps:

```text
1. Lex source.
2. Parse into AST with spans.
3. Build symbol tables for models, fields, relations, workflows, triggers, steps, integrations, policies, guarantees, tests, and custom declarations.
4. Resolve references.
5. Expand shorthand and defaults.
6. Produce a draft semantic model or draft IR.
7. Validate source semantics.
8. Generate canonical IR.
9. Generate guarantee-derived tests, verification metadata, artifact intent, and ownership intent.
10. Validate canonical IR against `arch.ir.v1`.
11. Serialize canonical IR deterministically and store an IR snapshot.
```

Agents enter only after typed diffing, dependency graph construction, and sync planning. They receive bounded patch tasks against allowed generated artifacts or regions; they do not parse `.arch`, decide diffs, create plans from scratch, bypass ownership rules, weaken guarantees, or mark verification passed.

### 21.2 Construct mapping table

| `.arch` construct | IR construct(s) |
|---|---|
| `system Name {}` | `SystemIR` |
| `target {}` | `TargetIR` |
| `model Name {}` | `ModelIR` |
| model field | `FieldIR` |
| model reference field | `FieldIR` + `RelationIR` |
| inverse relation field | `RelationIR` metadata, no scalar column |
| `relation Name { ... }` inside a model | `RelationIR` for an existing model-reference field |
| field-level `indexed` / `index` | `FieldIR.constraints.indexed = true` |
| named `index ...` | reserved; no V1 IR mapping |
| `workflow Name {}` | `WorkflowIR` |
| `trigger: api.METHOD("/path")` | `TriggerIR` |
| `trigger: manual(...)` / `trigger: schedule.cron(...)` | reserved; no V1 IR mapping |
| supported step line | `StepIR` |
| reserved step line | reserved; no V1 IR mapping |
| `integration Name {}` | `IntegrationIR` |
| integration `config {}` | `IntegrationIR.config_schema` |
| `policy Name {}` | `PolicyIR` |
| `policies { require ... }` | generated `PolicyIR` |
| `policies { use Name }` | reference to existing `PolicyIR` in enclosing scope |
| short guarantee | `GuaranteeIR` + often `TestIR` |
| long guarantee | `GuaranteeIR` + verification metadata |
| `tests { generate ... }` | `TestIR` |
| `tests { verify guarantee ... }` | `TestIR` linked by `guarantee_id` |
| `tests { include custom ... }` | `TestIR` with `generated=false` and ownership metadata |
| `custom Name {}` | `CustomExtensionIR`, extension-point `ArtifactIR`/`OwnershipIR`; `StepIR` if called |

### 21.3 Field example mapping

Source:

```arch
visibility: enum["public", "private", "followers"] default "public"
```

IR:

```json
{
  "id": "model.Post.field.visibility",
  "kind": "model_field",
  "name": "visibility",
  "model_id": "model.Post",
  "type": {
    "kind": "enum",
    "values": ["public", "private", "followers"]
  },
  "constraints": {
    "required": true,
    "unique": false,
    "primary": false,
    "indexed": false,
    "immutable": false,
    "default": "public"
  }
}
```

### 21.4 Workflow example mapping

Source:

```arch
workflow CreatePost {
  trigger: api.POST("/posts")

  steps {
    validate input as Post
    sanitize Post.content as html_safe
    insert Post
    notify mentioned_users via PushProvider best_effort
  }
}
```

IR fragments:

```json
{
  "id": "workflow.CreatePost",
  "kind": "workflow",
  "name": "CreatePost",
  "trigger": {
    "id": "workflow.CreatePost.trigger.api_post_posts",
    "kind": "trigger",
    "name": "api_post_posts",
    "workflow_id": "workflow.CreatePost",
    "trigger_kind": "api",
    "api": {
      "method": "POST",
      "path": "/posts",
      "auth_required": true
    }
  },
  "steps": [
    "workflow.CreatePost.step.validate_input",
    "workflow.CreatePost.step.sanitize_post_content",
    "workflow.CreatePost.step.insert_post",
    "workflow.CreatePost.step.notify_mentioned_users"
  ]
}
```

```json
{
  "id": "workflow.CreatePost.step.notify_mentioned_users",
  "kind": "workflow_step",
  "name": "notify_mentioned_users",
  "workflow_id": "workflow.CreatePost",
  "order": 4,
  "operation": {
    "type": "notify_users",
    "integration_id": "integration.PushProvider",
    "parameters": {
      "audience": "mentioned_users"
    }
  },
  "uses_integrations": ["integration.PushProvider"],
  "failure_behavior": "continue",
  "transaction_boundary": "outside_transaction"
}
```

### 21.5 Policy example mapping

Source:

```arch
policies {
  require auth for all api routes
}
```

IR:

```json
{
  "id": "policy.require_auth_for_all_api_routes",
  "kind": "policy",
  "name": "require_auth_for_all_api_routes",
  "policy_kind": "auth",
  "scope": ["target.primary"],
  "rules": [
    {
      "field": "auth.required",
      "operator": "equals",
      "value": true
    }
  ],
  "enforcement": "generated_code"
}
```

### 21.6 Test example mapping

Source:

```arch
tests {
  generate integration_tests for workflow.CreatePost
}
```

IR:

```json
{
  "id": "test.create_post_integration",
  "kind": "test",
  "name": "create_post_integration",
  "test_kind": "integration",
  "framework": "vitest",
  "path": "tests/generated/createPost.integration.test.ts",
  "scope": ["workflow.CreatePost"],
  "assertions": [],
  "fixtures": [],
  "generated": true
}
```

---

## 22. Semantic Validation

### 22.1 Validation categories

Semantic validation runs after parsing and before IR is accepted.

Categories:

```text
- document validation
- target validation
- model and field validation
- relation validation
- workflow and trigger validation
- step validation
- integration validation
- policy validation
- guarantee validation
- test validation
- custom extension validation
- cross-entity conflict validation
- V1 feature support validation
```

### 22.2 Document validation

```text
- Exactly one system declaration.
- Exactly one target declaration.
- At least one model or workflow for generation.
- No duplicate entity names in the same namespace.
- No unsupported top-level declarations.
```

### 22.3 Target validation

```text
- Only allowed V1 target values.
- language defaults to typescript when omitted.
- runtime must be node.fastify.
- database must be postgres.
- orm must be prisma.
- test_framework must be vitest.
- cache must be redis or none.
- cache none rejects cache update steps unless the behavior is represented by a custom extension point.
- local_runtime defaults to docker_compose and package_manager defaults to pnpm when omitted.
```

### 22.4 Model validation

```text
- Each model has exactly one primary field.
- Field names are unique.
- Type modifiers are compatible with field types.
- Defaults are compatible with field types.
- Enum values are unique.
- Model references resolve.
- Required relation cannot use on_delete set_null.
- Scalar arrays are rejected.
- Implicit many-to-many relations are rejected.
- Named index declarations are rejected in normal V1; field-level indexed/index is supported.
```

### 22.5 Workflow validation

```text
- Workflow names are unique.
- Exactly one trigger per workflow.
- API trigger method/path is unique.
- Steps are supported V1 operations.
- Steps reference existing entities.
- Integration kind matches step operation.
- Sanitization/moderation steps precede persistence when required by guarantees.
- Transaction boundaries do not violate guarantees.
```

### 22.6 Guarantee validation

```text
- Guarantee name is unique.
- Short forms match known patterns or declared long-form guarantees.
- Scope resolves.
- Predicate references resolve.
- Testable guarantees map to generated tests.
- Partial guarantees declare limitations.
- Unsupported guarantees fail normal apply.
- Unknown short-form guarantees fail normal apply.
- Latency guarantees are partially verifiable and cannot be marked locally proven by Vitest or Docker Compose checks.
```

### 22.7 Test and custom extension validation

```text
- Generated tests must use Vitest.
- `property_tests` is reserved and rejected in V1.
- Custom test paths must be repository-relative and human-owned.
- Custom extension names must be unique.
- Custom extension file paths must be repository-relative.
- Custom extension input/output references must resolve to supported scalar types, models, or qualified references.
- `custom ... { kind: test_generator }` is reserved and rejected in normal V1.
- `call custom Name` must reference a declared custom extension.
- Completed custom extension implementations are not overwritten by Arch without explicit developer confirmation.
```

### 22.8 Cross-entity validation

Examples:

```text
- A notify step references an existing push/email/custom integration.
- A moderation guarantee requires a moderation step before insert.
- An auth policy applies only when target.auth is not none or custom auth exists.
- A latency guarantee references an existing workflow.
- A custom call references a declared custom extension.
```

---

## 23. Error and Diagnostic Style

### 23.1 Error format

Compiler diagnostics should be structured and human-readable.

Example:

```text
Error ARCH-REF-001:
Workflow CreatePost step notify_mentioned_users references integration PushProvider, but no integration named PushProvider exists.

File: backend.arch
Line: 42
Column: 7
Source: notify mentioned_users via PushProvider

Help:
Declare an integration named PushProvider, or change the step to reference an existing integration.
```

### 23.2 Diagnostic fields

Machine-readable diagnostics should include:

```json
{
  "severity": "error",
  "code": "ARCH-REF-001",
  "message": "Workflow CreatePost references integration PushProvider, but no integration named PushProvider exists.",
  "file": "backend.arch",
  "line": 42,
  "column": 7,
  "entity_id": "workflow.CreatePost.step.notify_mentioned_users",
  "source_id": "source.backend_arch.workflow.CreatePost.step.notify_mentioned_users",
  "help": "Declare integration PushProvider or update the step reference."
}
```

### 23.3 Error code categories

| Prefix | Category |
|---|---|
| `ARCH-LEX` | lexical errors |
| `ARCH-SYN` | syntax errors |
| `ARCH-SEM` | general semantic errors |
| `ARCH-REF` | unresolved or invalid references |
| `ARCH-TYPE` | invalid types or modifiers |
| `ARCH-MODEL` | model and field errors |
| `ARCH-REL` | relation errors |
| `ARCH-WF` | workflow and step errors |
| `ARCH-TRIG` | trigger errors |
| `ARCH-INT` | integration errors |
| `ARCH-POL` | policy errors |
| `ARCH-GUAR` | guarantee errors |
| `ARCH-TEST` | test declaration errors |
| `ARCH-CUSTOM` | custom extension errors |
| `ARCH-V1` | unsupported V1 feature errors |
| `ARCH-PLAN` | planning and destructive-change diagnostics |
| `ARCH-OWN` | ownership boundary diagnostics |
| `ARCH-DRIFT` | implementation drift diagnostics |

### 23.4 Common errors

#### Duplicate model

```text
Error ARCH-MODEL-001:
Duplicate model `User`.

File: backend.arch
Line: 28
```

#### Missing primary key

```text
Error ARCH-MODEL-002:
Model Post must declare exactly one primary field.

File: backend.arch
Line: 12
Help: Add a field such as `id: uuid primary`.
```

#### Invalid modifier

```text
Error ARCH-TYPE-002:
Modifier `max` is valid only for string and text fields.

File: backend.arch
Line: 17
Source: age: int max 120
```

#### Unsupported many-to-many

```text
Error ARCH-REL-004:
Implicit many_to_many relations are not supported in V1.

File: backend.arch
Line: 10
Help: Declare an explicit join model.
```

#### Unsupported trigger

```text
Error ARCH-TRIG-002:
Trigger kind `schedule` is reserved but unsupported in V1.

File: backend.arch
Line: 35
Help: V1 generated workflows support API triggers only.
```

#### Unsupported step

```text
Error ARCH-WF-009:
Step operation `query` is reserved but unsupported in V1.

File: backend.arch
Line: 44
Help: Use a custom extension point for custom query behavior.
```

#### Unknown guarantee

```text
Error ARCH-GUAR-001:
Unknown short-form guarantee `feed_feels_relevant`.

File: backend.arch
Line: 51
Help: Use a supported guarantee pattern or declare a long-form guarantee.
```

### 23.5 Warnings

Warnings are non-fatal but should be included in plan output.

Examples:

```text
Warning ARCH-WARN-STYLE-001:
Field bio has no explicit required/optional modifier. It defaults to required.

Warning ARCH-WARN-GUAR-002:
Latency guarantee post_creation_p95_latency is only partially verifiable in V1.
```

### 23.6 Destructive change warnings

Destructive changes are not syntax errors, but `arch plan` must require explicit confirmation before apply.

Example:

```text
Warning ARCH-PLAN-DEST-001:
Model Post was removed.

Potential effects:
- drop posts table
- delete generated Post model files
- delete workflows referencing Post
- delete generated tests for Post guarantees

Action required:
Run apply with explicit destructive confirmation or revise the spec.
```

---

## 24. Formatter Rules

### 24.1 Formatting goals

A formatter should produce stable, readable output without changing semantics.

Formatting-only changes, including whitespace, comments, blank lines, and equivalent shorthand expansion, must not cause implementation diffs. If a formatter changes workflow step order or enum value order, it has changed semantics and must be treated as a source bug.

### 24.2 Indentation

Use two spaces per block level.

```arch
system SocialFeed {
  model User {
    id: uuid primary
  }
}
```

### 24.3 Blank lines

Recommended:

```text
- blank line between major declarations
- blank line before steps, guarantees, and tests blocks inside workflows
- no blank lines between simple field declarations unless grouping is intentional
```

### 24.4 Property order

Target property order:

```text
language
runtime
database
orm
cache
auth
test_framework
local_runtime
package_manager
```

Integration property order:

```text
kind
provider
required
failure_policy
config
```

Policy property order:

```text
kind
scope
enforcement
rules
```

Guarantee property order:

```text
scope
category
description
assert
verify
verifiability
```

### 24.5 Reordering

The formatter may reorder:

```text
- target properties
- integration properties
- guarantee properties
- policy properties
```

The formatter must not reorder:

```text
- workflow steps
- enum values
```

The formatter should not reorder model fields by default because field order affects human readability and migration review, even though canonical IR uses stable IDs.

### 24.6 Semicolons

Semicolons are optional. The formatter should omit them.

---

## 25. Syntax Highlighting Guidance

A syntax highlighter should classify:

| Token class | Examples |
|---|---|
| Declaration keywords | `system`, `model`, `workflow`, `integration` |
| Block keywords | `target`, `steps`, `guarantees`, `tests`, `config` |
| Step verbs | `validate`, `moderate`, `sanitize`, `insert`, `notify`, `call`, `return` |
| Reserved unsupported step verbs | `query`, `delete`, `enqueue`, `if` |
| Types | `string`, `uuid`, `timestamp`, `json`, `enum` |
| Modifiers | `primary`, `unique`, `required`, `optional`, `default`, `max` |
| Trigger functions | `api.GET`, `api.POST`, `api.PUT`, `api.PATCH`, `api.DELETE` |
| Literals | strings, numbers, booleans, durations |
| References | `Post.content`, `workflow.CreatePost` |
| Comments | `//`, `#`, `/* */` |
| Unsupported V1 constructs | `schedule`, `manual`, `many_to_many`, `property_tests` |

Highlighters should not need semantic resolution, but may visually distinguish reserved unsupported syntax.

---

## 26. Complete Valid Example

```arch
system SocialFeed {
  target {
    runtime: node.fastify
    database: postgres
    orm: prisma
    cache: redis
    auth: oauth.github
  }

  model User {
    id: uuid primary
    username: string unique required
    bio: string max 280 optional
    created_at: timestamp default now immutable
  }

  model Post {
    id: uuid primary
    author: User required relation many_to_one on_delete restrict
    content: string max 5000
    visibility: enum["public", "private", "followers"] default "public" indexed
    created_at: timestamp default now immutable
  }

  integration LLMModeratorGuardrail {
    kind: llm_moderation
    provider: custom
    required: true
    failure_policy: fail_workflow
  }

  integration PushProvider {
    kind: push
    provider: custom
    required: false
    failure_policy: best_effort
  }

  custom PostRankingStrategy {
    kind: function
    input: Post
    output: decimal
    file: "src/custom/postRankingStrategy.ts"
    export: "postRankingStrategy"
  }

  policies {
    require auth for all api routes
  }

  workflow CreatePost {
    trigger: api.POST("/posts")
    input: Post
    output: Post

    steps {
      validate input as Post
      moderate Post.content using LLMModeratorGuardrail
      sanitize Post.content as html_safe
      insert Post
      update FeedCache for author.followers
      notify mentioned_users via PushProvider best_effort
      return Post
    }

    guarantees {
      no_unsanitized_html_persisted
      notification_failure_does_not_rollback_post
      post_creation_p95_latency <= 200ms
    }

    tests {
      generate integration_tests for workflow.CreatePost
    }
  }

  workflow RankPost {
    trigger: api.POST("/posts/:id/rank")
    input: Post
    output: Post

    steps {
      validate input as Post
      call custom PostRankingStrategy with Post
      return Post
    }

    tests {
      generate unit_tests for workflow.RankPost
    }
  }
}
```

---

## 27. Invalid Examples

### 27.1 Free-form workflow step

Invalid:

```arch
steps {
  send email digest if user is offline
}
```

Reason:

```text
The step is unconstrained natural language. Use a supported step form or a custom extension point.
```

Valid alternative:

```arch
custom SendEmailDigest {
  kind: workflow_step
  input: User
  output: boolean
  file: "src/custom/sendEmailDigest.ts"
  export: "sendEmailDigest"
}

steps {
  call custom SendEmailDigest with User
}
```

### 27.2 Missing integration

Invalid:

```arch
workflow CreatePost {
  trigger: api.POST("/posts")

  steps {
    notify mentioned_users via PushProvider
  }
}
```

Reason:

```text
PushProvider is not declared as an integration.
```

### 27.3 Unsupported schedule trigger

Invalid in V1:

```arch
workflow RebuildFeed {
  trigger: schedule.cron("0 * * * *")

  steps {
    call custom RebuildFeedIndex
  }
}
```

Reason:

```text
schedule triggers are reserved but unsupported in V1 generated workflows.
```

### 27.4 Implicit many-to-many

Invalid:

```arch
model User {
  id: uuid primary
  followers: User[] relation many_to_many
}
```

Reason:

```text
V1 requires explicit join models for many-to-many relationships.
```

### 27.5 Invalid enum default

Invalid:

```arch
visibility: enum["public", "private"] default "followers"
```

Reason:

```text
Default value must be one of the enum values.
```

### 27.6 Invalid field modifier

Invalid:

```arch
age: int max 120
```

Reason:

```text
max is a string/text length modifier in V1.
```

### 27.7 Unknown guarantee

Invalid:

```arch
guarantees {
  product_should_feel_fast
}
```

Reason:

```text
Unknown short-form guarantee. Use a latency threshold or long-form guarantee.
```

Valid alternative:

```arch
guarantees {
  create_post_p95_latency <= 200ms
}
```

### 27.8 Duplicate API route

Invalid:

```arch
workflow A {
  trigger: api.POST("/posts")
  steps { validate input }
}

workflow B {
  trigger: api.POST("/posts")
  steps { validate input }
}
```

Reason:

```text
Two workflows cannot own the same API method/path pair.
```

---

## 28. V1 Unsupported Features

V1 explicitly does not support:

```text
- arbitrary free-form code inside `.arch`
- arbitrary natural-language requirements as executable behavior
- arbitrary app generation
- frontend UI generation
- mobile app generation
- multiple backend languages
- backend frameworks other than Fastify
- databases other than PostgreSQL
- ORMs other than Prisma
- multiple `.arch` source files without deterministic preprocessing
- multi-service orchestration
- Kubernetes or production cloud deployment automation
- complex distributed workflows
- complex distributed transactions
- complex event streaming
- queue/event triggers
- schedule triggers in generated code
- manual triggers in generated code
- implicit many-to-many relations
- scalar array fields
- scalar array persistence
- advanced type-level programming
- arbitrary nested object schemas outside `json`
- arbitrary integration calls
- provider-complete SDK support for integrations
- custom test-generator extension execution
- complex auth policy languages
- full formal verification
- unconstrained or autonomous long-running agents
- implementation agents parsing `.arch`, deciding diffs, creating sync plans from scratch, bypassing ownership, weakening guarantees, or marking verification passed
- automatic destructive migrations without confirmation
- hidden no-code runtime behavior
```

Unsupported features must produce explicit diagnostics. They must not be silently handed to an LLM or hidden inside generated code.

---

## 29. Destructive and Ambiguous Changes

### 29.1 Destructive changes

Examples:

```text
- removing a model
- removing a persisted field
- removing a relation
- changing a field type incompatibly
- changing database, ORM, language, or runtime target
- removing a workflow
- removing a guarantee
- weakening a security or transactional guarantee
```

`arch plan` must require explicit developer confirmation before applying destructive changes.

### 29.2 Ambiguous changes

Examples:

```text
- model removed and similar model added without rename metadata
- field removed and similar field added
- guarantee category and predicate both changed
- integration provider changed with no migration strategy
- workflow step text changed into an unsupported or unclear operation
```

Ambiguous changes must not be guessed. The planner should require explicit migration metadata, confirmation, or a rewritten spec.

---

## 30. Open Questions for Future Versions

These are outside V1 but should be revisited:

```text
1. Explicit rename syntax, such as `renamed_from model.Post`.
2. Richer custom extension contracts, including V1-reserved custom test generators.
3. Persistent update, delete, and query workflow operations.
4. Queue, event, webhook, schedule, and manual triggers.
5. Scalar array fields and richer collection types.
6. First-class composite indexes and composite unique constraints.
7. First-class input DTO declarations separate from persistence models.
8. Rich authorization policy language.
9. Provider-specific deterministic integration templates.
10. Multi-file `.arch` projects with deterministic module resolution.
11. Multi-service systems and service boundaries.
12. Richer formal predicate language for guarantees.
13. Property-based test generation.
14. Production observability and SLO verification semantics.
15. Advanced drift detection beyond generated hashes and supported static patterns.
```

---

## 31. Summary

The `.arch` language is the durable human-authored source of truth for Arch V1 backend systems. It is declarative, typed, bounded, deterministic, and designed to compile into canonical IR.

The language exists to make backend intent explicit before implementation agents are used.

The compiler must be able to parse `.arch`, validate it, produce stable IR, compute typed diffs, map changes to generated artifacts, generate or update tests, enforce ownership boundaries, detect drift, and report errors with precise source locations.

The guiding rule remains:

```text
Do not ask an LLM to infer what the system means from prose.
Make the system intent explicit, typed, diffable, and verifiable first.
```
