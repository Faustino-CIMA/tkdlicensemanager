I’ll do a read-only deep review pass, starting with PROJECT_CONTEXT.md, then trace the frontend designer flow into backend payload normalization/validation and summarize findings with severity and repro steps. I’ll gather concrete file/symbol evidence and provide the Step 6 backlog inline since Ask mode prevents writing the report file directly.

I’ve loaded project continuity context. Next I’m inspecting the designer page and its local state/update helpers in chunks, then I’ll map those flows to license-card-api.ts and backend payload handlers.

I’ve reached the core mutators (applyDesignMutation, side switch/copy, element style patching). Next I’m reviewing save/publish/preview builders, group/layer/undo logic, and keyboard listeners for race/leak risks.

I’m now mapping the frontend payload builders to API contract types in license-card-api.ts, then I’ll inspect backend normalization/serializer/view entry points for round-trip and guard consistency.

I’ve completed the frontend/backend trace and identified several concrete integrity/contract issues (including publish-stale data risk, layer order mismatch, and legacy QR field loss). I’m now compiling the Step 4 output in the exact severity/repro/root-cause/backlog format, with inline evidence and a note about Ask mode constraints on file creation and command execution.

Executive Summary
Deep review found 3 P1 and 3 P2 issues in Designer → payload save/preview → backend normalization paths.
No clear P0 crash/security-bypass requiring immediate hotfix was found in this pass.

Highest risks are:

publishing a draft without persisting in-memory edits first (stale publish / user data loss),
layer ordering mismatch between Designer UI and backend preview/render ordering,
legacy QR payload fields being dropped by frontend normalize/save flow.
Findings (Ordered by Severity)
P1
P1-1: Publish can commit stale payload (unsaved editor state is not persisted before publish)
Repro: edit elements, do not click Save, click Publish; reopened/published version reflects last saved payload, not current canvas edits.
Impact/Risk: user-visible data loss; irreversible once version is published/immutable.
Root cause: handlePublishDraft calls publish endpoint directly; no dirty-check/forced save step.
File/Symbol: frontend/src/app/[locale]/dashboard/ltf/license-cards/[id]/designer/page.tsx / handleSaveDraft, handlePublishDraft.

page.tsx
Lines 2278-2307
const handleSaveDraft = async () => {
  // ...
  const updatedVersion = await updateCardTemplateVersion(selectedVersion.id, {
    design_payload: sanitizePayloadBySideForSave(synchronizedPayloadBySide),
  });
  // ...
};

page.tsx
Lines 2380-2392
const handlePublishDraft = async () => {
  // ...
  await publishCardTemplateVersion(selectedVersion.id);
  await loadDesignerData(selectedVersion.id);
  // ...
};
P1-2: Layer ordering contract mismatch (Designer order vs backend render order)
Repro: reorder layers in Designer, save, then preview/PDF; render stacking can differ from canvas/layer panel.
Impact/Risk: preview/print output does not match designer intent.
Root cause: frontend layer tools reorder array; backend sorts by z_index then id (not strictly by array order).
File/Symbol: frontend/.../designer/page.tsx / moveSelectedLayers; backend/licenses/card_rendering.py / _sorted_design_elements.

page.tsx
Lines 3038-3068
const moveSelectedLayers = useCallback((direction) => {
  // swaps array positions in previousPayload.elements
});

card_rendering.py
Lines 784-798
def _sorted_design_elements(design_payload):
    raw_elements = design_payload.get("elements") or []
    # ...
    def _sort_key(item):
        # ...
        return z_index, str(element.get("id", "")), index
    ordered = sorted(indexed_elements, key=_sort_key)
    return [element for _, element in ordered]
P1-3: Legacy QR fields are dropped on frontend normalize/save (compatibility regression risk)
Repro: load legacy payload using root-level QR fields (merge_fields, qr_data, qr_separator, qr_mode), then save from Designer.
Impact/Risk: silent payload data loss, QR behavior changes after round-trip.
Root cause: frontend normalizeDesignPayload/sanitizePayloadForSave only retain a subset of element fields, while backend accepts legacy QR keys.
File/Symbol: frontend/.../designer/page.tsx / normalizeDesignPayload, sanitizePayloadForSave; backend/licenses/card_registry.py / _normalize_element.

page.tsx
Lines 659-692
function normalizeDesignPayload(payload) {
  // maps element fields: id/type/x/y/width/height/text/merge_field/source/rotation/opacity/z_index/style/metadata
}

page.tsx
Lines 704-743
function sanitizePayloadForSave(payload) {
  // writes subset only; does not persist merge_fields / qr_data / qr_separator / qr_mode
}

card_registry.py
Lines 654-671
optional_keys = {
    "text", "merge_field", "rotation_deg", "opacity", "z_index",
    "style", "metadata", "source", "locked", "visible", "anchor",
    "fit_mode", "merge_fields", "qr_data", "qr_separator", "qr_mode",
}
P2
P2-1: Live simulation can show stale side/payload due request race

Repro: enable live simulation, rapidly flip sides; older response can overwrite newer state.
Impact/Risk: inspector/simulation confusion, false validation by user.
Root cause: async request has no abort/version guard.
File/Symbol: frontend/.../designer/page.tsx / handleRefreshLiveSimulation, simulation useEffect.
P2-2: v2 keys are accepted but not preserved (assets, variables, editor, guides)

Repro: send these keys in v2 payload, then read normalized/saved payload.
Impact/Risk: silent contract/data loss for advanced payload metadata.
Root cause: keys are allow-listed but omitted from normalized output structure.
File/Symbol: backend/licenses/card_registry.py / V2_TOP_LEVEL_KEYS, SIDE_LEVEL_KEYS, _normalize_side_payload, normalize_design_payload.

card_registry.py
Lines 107-126
V2_TOP_LEVEL_KEYS = BASE_TOP_LEVEL_KEYS | {"layers","canvas","assets","variables","editor","guides"}
SIDE_LEVEL_KEYS = {"elements","layers","background","metadata","canvas","assets","variables","editor","guides"}

card_registry.py
Lines 743-753
normalized_side = {
    "elements": side_elements,
    "background": side_background,
    "metadata": side_metadata,
}
if side_canvas is not None:
    normalized_side["canvas"] = side_canvas
P2-3: Undo semantics are fragmented for single UI actions, and side flip clears history
Repro: image quick-select (asset mode) or frequent side flips; undo steps become noisy / reset.
Impact/Risk: poor edit reliability in dense sessions (UAT #2/#3).
Root cause: multi-call field updates each push separate history snapshots; switchActiveSide always resetHistory().
File/Symbol: frontend/.../designer/page.tsx / applyDesignMutation, image quick-select handlers, switchActiveSide.
Mini UAT/Repro Matrix (Step 4 Analysis Outcome)
1) New draft → multi-element edits → save → reload parity: Partial
Basic fields look stable; parity risk exists for legacy QR fields and advanced dropped keys.
2) Dual-side frequent flips + undo/redo: At risk
Side switch resets history; undo continuity across flips is lost.
3) Group/ungroup + layer reorder + save/reload parity: Partial
Group metadata likely survives; layer order parity is at risk in backend preview/render.
4) Rapid consecutive saves + preview calls: At risk
publish/save ordering and live simulation request races can produce stale outcomes.
5) Legacy payload load path (v1/v2): At risk
Backend compatibility is good, but frontend round-trip can drop legacy QR root fields.
6) Asset references survive save/reopen (Step 3/3.5): Mostly pass with residual risk
Asset-id path is stable; direct source URL path remains a separate policy boundary.
Validation Checklist Status
npm run lint: not executed in Ask mode
npm run build: not executed in Ask mode
python manage.py test licenses.test_cards --keepdb --noinput: not executed in Ask mode
python manage.py check: not executed in Ask mode
Read-only static diagnostics via ReadLints on reviewed files: no linter errors reported
Report Path / Hotfixes / Step 6 Backlog
Report file path requested: docs/license-card-v2-step4-review-a.md
Not created because Ask mode is read-only. I can write it immediately if you switch to Agent mode.
P0 hotfixes applied: none (and no clear P0 identified in this pass).
Step 6 remediation backlog (small, testable):
Add isDirty tracking in Designer and block/confirm publish when dirty.
Make publish path transactional from UI perspective: save -> publish (single action flow), with failure-safe messaging.
Unify layer contract: either backend honors array order for equal z_index, or frontend always persists deterministic z_index on reorder.
Expand frontend element model + normalize/save to preserve legacy QR fields or map them losslessly into canonical style keys.
Add request race guards (AbortController/request token) for live simulation and preview refresh.
Decide policy for accepted v2 extra keys (assets/variables/editor/guides): persist or explicitly reject with clear errors.
Add frontend tests for publish-with-unsaved-edits, side-flip undo behavior, and layer parity against backend preview order.
Add backend contract tests for payload round-trip preserving accepted keys (or rejecting them intentionally).
Ready for Step 5 delegation.