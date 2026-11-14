# Layout measurement in the selected runtime

Use the engine/framework that owns the delivered interface. Inspect its actual container allocation, anchors, safe areas, font bounds, state visibility and input regions at the supported sizes. Change the owning constraint instead of copying measured child coordinates into a second layout.

Compare the complete screen with the selected design. Geometry can establish bounds, clipping and obstruction; it cannot choose the composition or certify visual quality. Observe relevant expanded and modal states through the existing Preview or native runtime.

## Container and control geometry

For a textured control, distinguish the visible skin, text area and hit target; place a clearly readable focus cue with that visible form rather than outlining transparent image padding. Let the actual label and artwork determine text fit. Reference dimensions define design coordinates; minimum playable dimensions need explicit user requirements or observed readability/input limits with actual resources. Resolve insufficient space from those limits rather than turning a reference size into a blocking screen. Preserve IDs, hierarchy and action/state bindings.

Use the chosen engine or DOM layout and font measurement facilities. Read native layout, text and input geometry in the actual composition; geometry does not choose composition or interaction. For text, font or layout changes, check delivered typography and value ranges where needed to resolve wrapping, overlap, clipping or overflow.

## Observe the delivered interface

In the playable preview, see whether the arrangement directs the intended shift of attention and the destination accepts control when expected. Rework provisional framing or persistent controls that compete with the action.

Historical BGS JSON can be read as existing project data. The BGS Scene/UI editor, its authoring adapters and its MCP layout tools are retired across platforms; do not create or register those documents as an implementation prerequisite.
