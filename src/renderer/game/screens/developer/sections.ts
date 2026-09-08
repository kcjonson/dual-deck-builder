import type { Panel } from '../../../engine/ui/Panel';
import { InteractiveControlsSection } from './InteractiveControlsSection';
import { StyleGuideSection } from './StyleGuideSection';
import { InputShowcaseSection } from './InputShowcaseSection';
import { RectangleExamplesSection } from './RectangleExamplesSection';
import { ButtonExamplesSection } from './ButtonExamplesSection';
import { TextExamplesSection } from './TextExamplesSection';
import { PrimitiveShapesSection } from './PrimitiveShapesSection';
import { NestedPanelsSection } from './NestedPanelsSection';

/**
 * The developer screen's sections, defined once.
 *
 * DeveloperScreen stacks all eight in its scroll container and the gallery
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
 * An entry carries no size and no viewport. A section computes its own height
 * from its content and publishes it with setSize on the last line of its
 * constructor, so the height does not exist until the builder has returned;
 * both callers read it there. A width in the entry would be a second answer to
 * a question the container already answers.
 */

export interface DeveloperSectionOptions {
	x: number;
	y: number;
	width: number;
}

/**
 * Sections take positional (x, y, width) arguments; the builder wraps that in
 * the named form new code uses, so the list reads the same as the rest of the
 * codebase without rewriting eight constructors.
 */
export type DeveloperSectionBuilder = (options: DeveloperSectionOptions) => Panel;

export interface DeveloperSection {
	name: string;
	build: DeveloperSectionBuilder;
}

export const developerSections: readonly DeveloperSection[] = [
	{
		name: 'interactive-controls',
		build: ({ x, y, width }) => new InteractiveControlsSection(x, y, width),
	},
	{
		name: 'style-guide',
		build: ({ x, y, width }) => new StyleGuideSection(x, y, width),
	},
	{
		name: 'input-showcase',
		build: ({ x, y, width }) => new InputShowcaseSection(x, y, width),
	},
	{
		name: 'rectangles',
		build: ({ x, y, width }) => new RectangleExamplesSection(x, y, width),
	},
	{
		name: 'buttons',
		build: ({ x, y, width }) => new ButtonExamplesSection(x, y, width),
	},
	{
		name: 'text',
		build: ({ x, y, width }) => new TextExamplesSection(x, y, width),
	},
	{
		name: 'primitive-shapes',
		build: ({ x, y, width }) => new PrimitiveShapesSection(x, y, width),
	},
	{
		name: 'nested-panels',
		build: ({ x, y, width }) => new NestedPanelsSection(x, y, width),
	},
];
