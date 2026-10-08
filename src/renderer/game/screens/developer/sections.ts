import type { Panel } from '../../../engine/ui/Panel';
import type { DeveloperSectionOptions } from './DeveloperSectionPanel';
import { InteractiveControlsSection } from './InteractiveControlsSection';
import { StyleGuideSection } from './StyleGuideSection';
import { InputShowcaseSection } from './InputShowcaseSection';
import { RectangleExamplesSection } from './RectangleExamplesSection';
import { ButtonExamplesSection } from './ButtonExamplesSection';
import { TextExamplesSection } from './TextExamplesSection';
import { PrimitiveShapesSection } from './PrimitiveShapesSection';
import { NestedPanelsSection } from './NestedPanelsSection';
import { PaintOrderFixturesSection } from './PaintOrderFixturesSection';
import { ClippingFixturesSection } from './ClippingFixturesSection';
import { ShadingFixturesSection } from './ShadingFixturesSection';
import { IconExamplesSection } from './IconExamplesSection';
import { StackExamplesSection } from './StackExamplesSection';
import { ButtonVariantsSection } from './ButtonVariantsSection';
import { ListExamplesSection } from './ListExamplesSection';
import { CheckboxExamplesSection } from './CheckboxExamplesSection';
import { RadioExamplesSection } from './RadioExamplesSection';
import { PanelExamplesSection } from './PanelExamplesSection';
import { ScrollExamplesSection } from './ScrollExamplesSection';
import { LeafExamplesSection } from './LeafExamplesSection';
import { MenuExamplesSection } from './MenuExamplesSection';
import { MeterExamplesSection } from './MeterExamplesSection';
import { DataDisplaySection } from './DataDisplaySection';
import { TreeExamplesSection } from './TreeExamplesSection';
import { CombatFxSection } from './CombatFxSection';
import { CombatLogSection } from './CombatLogSection';
import { CombatRoadSection } from './CombatRoadSection';
import { CardDetailCapSection, CardDetailPinnedSection, CardDetailSection, CardFacesSection } from './CardDetailSection';
import { CardMinisSection } from './CardMinisSection';
import { SliderTabsSection } from './SliderTabsSection';
import { VehicleTokensSection } from './VehicleTokensSection';
import { CombatTargetingSection } from './CombatTargetingSection';
import { CombatDockCrashedOutSection, CombatDockSection } from './CombatDockSection';

/**
 * The developer screen's sections, defined once.
 *
 * DeveloperScreen stacks all of them in its scroll container and the gallery
 * registry (`src/gallery/registry.ts`) wraps each one as a scene, so the screen
 * and the `?scene=` gallery cannot drift apart. The list lives here, beside the
 * sections it names, rather than in `src/gallery/`: the gallery is a
 * development-only tool and the developer screen is a live game screen, so the
 * dependency has to point from the tool to the game. With it the other way
 * round the whole gallery directory was reachable from production code and
 * `registry.ts` compiled into the deployed web bundle and the packaged Electron
 * renderer.
 *
 * `name` is the gallery's `?scene=` value and, later, the golden-image name a
 * Playwright spec commits, so renaming one invalidates a baseline. The names
 * mirror the `dev_section_*` ids the sections already carry, which keeps a
 * scene name and the node id it selects derivable from each other.
 *
 * An entry carries no size and no viewport. A section is laid out by stacks
 * and hugs its content at the width it is given: the gallery fixes it, and
 * the developer screen's column stretches it, so a resize reflows it. A width
 * in the entry would be a second answer to a question the container already
 * answers.
 */

export type { DeveloperSectionOptions };

export type DeveloperSectionBuilder = (options: DeveloperSectionOptions) => Panel;

export interface DeveloperSection {
	name: string;
	build: DeveloperSectionBuilder;
}

export const developerSections: readonly DeveloperSection[] = [
	{
		name: 'interactive-controls',
		build: (options) => new InteractiveControlsSection(options),
	},
	{
		name: 'style-guide',
		build: (options) => new StyleGuideSection(options),
	},
	{
		name: 'input-showcase',
		build: (options) => new InputShowcaseSection(options),
	},
	{
		name: 'rectangles',
		build: (options) => new RectangleExamplesSection(options),
	},
	{
		name: 'buttons',
		build: (options) => new ButtonExamplesSection(options),
	},
	{
		name: 'text',
		build: (options) => new TextExamplesSection(options),
	},
	{
		name: 'primitive-shapes',
		build: (options) => new PrimitiveShapesSection(options),
	},
	{
		name: 'nested-panels',
		build: (options) => new NestedPanelsSection(options),
	},
	// The spec's rendering fixtures (3.12, 4.7, 5.10). Paint order is built
	// from components, so it proves the tree's ordering; clipping and shading
	// are drawn through the draw API rather than built from components.
	{
		name: 'paint-order',
		build: (options) => new PaintOrderFixturesSection(options),
	},
	{
		name: 'clipping',
		build: (options) => new ClippingFixturesSection(options),
	},
	{
		name: 'shading',
		build: (options) => new ShadingFixturesSection(options),
	},
	{
		name: 'icons',
		build: (options) => new IconExamplesSection(options),
	},
	// Chapter 10's layout fixture (R13.31), laid out by stacks throughout.
	{
		name: 'stack',
		build: (options) => new StackExamplesSection(options),
	},
	// Chapter 12's component catalog (phase 5), one scene per component group.
	{
		name: 'button-variants',
		build: (options) => new ButtonVariantsSection(options),
	},
	{
		name: 'lists',
		build: (options) => new ListExamplesSection(options),
	},
	{
		name: 'checkboxes',
		build: (options) => new CheckboxExamplesSection(options),
	},
	{
		name: 'radio-group',
		build: (options) => new RadioExamplesSection(options),
	},
	{
		name: 'panels',
		build: (options) => new PanelExamplesSection(options),
	},
	{
		name: 'scrolling',
		build: (options) => new ScrollExamplesSection(options),
	},
	{
		name: 'leaves',
		build: (options) => new LeafExamplesSection(options),
	},
	{
		name: 'menus',
		build: (options) => new MenuExamplesSection(options),
	},
	{
		name: 'meters',
		build: (options) => new MeterExamplesSection(options),
	},
	{
		name: 'data-display',
		build: (options) => new DataDisplaySection(options),
	},
	{
		name: 'tree-view',
		build: (options) => new TreeExamplesSection(options),
	},
	// The combat screen's overlay effects held still (DDB-88)
	{
		name: 'combat-fx',
		build: (options) => new CombatFxSection(options),
	},
	// The battle screen's top bar and open log drawer held still (DDB-140)
	{
		name: 'combat-log',
		build: (options) => new CombatLogSection(options),
	},
	{
		name: 'slider-tabs',
		build: (options) => new SliderTabsSection(options),
	},
	// The battle screen's road, lanes and slots held still (DDB-134)
	{
		name: 'combat-road',
		build: (options) => new CombatRoadSection(options),
	},
	// The battle screen's vehicle token in every state (DDB-135)
	{
		name: 'vehicle-tokens',
		build: (options) => new VehicleTokensSection(options),
	},
	// The card face and its detail view (DDB-137), one state a scene so each fits 1024x600
	{
		name: 'card-faces',
		build: (options) => new CardFacesSection(options),
	},
	{
		name: 'card-detail',
		build: (options) => new CardDetailSection(options),
	},
	{
		name: 'card-detail-pinned',
		build: (options) => new CardDetailPinnedSection(options),
	},
	{
		name: 'card-detail-cap',
		build: (options) => new CardDetailCapSection(options),
	},
	// The mini card in every state, stacked and tagged (DDB-311)
	{
		name: 'card-minis',
		build: (options) => new CardMinisSection(options),
	},
	// A card mid-drag over the road: ranges, outlines, ghost, hit check (DDB-138)
	{
		name: 'combat-targeting',
		build: (options) => new CombatTargetingSection(options),
	},
	// The battle screen's dock at its worst cases (DDB-136, DDB-167)
	{
		name: 'combat-dock',
		build: (options) => new CombatDockSection(options),
	},
	{
		name: 'combat-dock-crashed-out',
		build: (options) => new CombatDockCrashedOutSection(options),
	},
];
