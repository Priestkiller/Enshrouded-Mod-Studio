# Create/export compatibility gate

`node tests/producer-consumer-matrix.js` executes the released JavaScript create
and export code for all seven nonempty combinations of companions, night plants
and the Drak merchant. Ten profiles cover defaults, mana, cast time, binary
rounding boundaries, the cast-time minimum, stack limits, item level, root skill
rewards and combined feature bounds. This currently produces 70 complete recipes.

The Studio 0.4.36 fixture comes from native build
`1283531|^/game38/branches/release_1.0|2026-10-30T09:15:50.868196Z`.
Its reduced reflection keeps that complete identity. Capture requires an
explicit local export root containing `server-input` and
`server-bin/reflection_data.json`. NPC and workshop source rows come from those
fresh exports. The original Studio 0.4.35 fixtures remain separate.

The companion and night-plant `apply` methods run on inert local inputs. Drak's
real `buildCreatedResources` and `modifyResource` methods run on minimal shared
registries. The real template-registration planner and resource-recipe exporter
then produce every after-image. No Go expected-document builder, copied created
resource or consumer mutation implementation generates these results.

The public input fixture contains only data: selected original descriptors,
reduced reflection metadata and minimal synthetic shared tables. Mana/cast and
root-reward source variants were captured by the reviewed original Studio
`ModProcessor` over inert inputs. `capture-producer-matrix-inputs.cjs` documents
that optional development capture; CI never loads vendor bytecode or starts the
native packer, Player worker, game, client installation or server.

`fixtures/producer-consumer-contract.json` records the canonical recipe digests
only after the independently generated recipes have passed the production Go
`ParseEMSResourceRecipe` parser. Public Studio CI checks these digests, allowing
it to reject producer drift without access to the private Manager repository.
The Manager release gate additionally regenerates the matrix and requires all
70 cases to pass its current production parser. Missing/skipped matrix tests
fail that gate. Consumer source SHA256 is certification provenance.
The source fixture digest, native build and frozen producer identity are bound
to the matrix index. A producer identity change during generation fails the run.

For a deliberate producer change, use an isolated review directory:

```powershell
node tests/producer-consumer-matrix.js --candidate-output <new-directory>
# In the paired Manager source checkout:
$env:UGSM_STUDIO_PRODUCER_MATRIX = '<new-directory>'
go test ./internal/player -run '^TestEMSStudioReleaseContractProducerMatrix$' -count=1 -v
```

Review the generated cases and paired consumer change before replacing the
reviewed contract digests. The normal CI/release commands never pass candidate
mode and never regenerate the reviewed contract automatically.

This gate covers create/export data compatibility. Captured vendor inputs do
not execute or prove the current proprietary dispatcher. Drak's outer native
registry hash checks, actual archive packing/readback, gameplay and multiplayer
are additional validation. `verify-studio-release-contract.ps1 -ActualRecipe
<recipe.json>` also requires an explicitly supplied real recipe to pass the
exact selected Studio/Manager/Player parser. That private recipe remains outside
the source tree; it supplements the mandatory public matrix.
