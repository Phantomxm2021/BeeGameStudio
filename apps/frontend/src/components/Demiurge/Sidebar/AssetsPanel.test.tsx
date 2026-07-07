import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { AssetsPanel } from './AssetsPanel';

describe('AssetsPanel', () => {
    it('renders engine asset contracts with MCP integration metadata', () => {
        render(
            <AssetsPanel
                manifest={{
                    version: 1,
                    project_target: {
                        kind: 'game_engine',
                        engine: 'unity',
                        integration_mode: 'mcp',
                        mcp_server: 'unity-mcp',
                    },
                    slots: [{
                        id: 'player_model',
                        name: 'Player model',
                        type: 'model_3d',
                        purpose: 'Playable character model',
                        required: true,
                        accepted_formats: ['glb', 'fbx'],
                        recommended_specs: {
                            poly_budget: '5k-15k tris',
                            scale_unit: 'meters',
                        },
                        integration_provider: {
                            type: 'mcp',
                            server: 'unity-mcp',
                            capabilities: ['import_asset'],
                        },
                    }],
                }}
                isLoading={false}
                onUpload={vi.fn()}
            />
        );

        expect(screen.getByText('Player model')).toBeInTheDocument();
        const scrollRegion = screen.getByText('Player model').closest('.overflow-y-auto');
        expect(scrollRegion).toHaveClass('overflow-y-auto');
        expect(scrollRegion).not.toHaveClass('scrollbar-hide');
        expect(screen.getByText('Playable character model')).toBeInTheDocument();
        expect(screen.getAllByText('MCP integration').length).toBeGreaterThan(0);
        expect(screen.getByText('model_3d')).toBeInTheDocument();
        expect(screen.getByText('glb, fbx')).toBeInTheDocument();
        expect(screen.getByText(/poly_budget: 5k-15k tris/)).toBeInTheDocument();
    });

    it('uploads a replacement file for a slot', async () => {
        const user = userEvent.setup();
        const onUpload = vi.fn(async () => undefined);

        render(
            <AssetsPanel
                manifest={{
                    version: 1,
                    project_target: { kind: 'web', engine: 'react', integration_mode: 'filesystem' },
                    slots: [{
                        id: 'main_logo',
                        name: 'Main logo',
                        type: 'image_2d',
                        purpose: 'Title logo',
                        required: false,
                    }],
                }}
                isLoading={false}
                onUpload={onUpload}
            />
        );

        const file = new File(['logo'], 'logo.png', { type: 'image/png' });
        await user.upload(screen.getByLabelText('Upload replacement'), file);

        expect(onUpload).toHaveBeenCalledWith('main_logo', file);
    });

    it('shows uploaded assets as pending integration and requests integration explicitly', async () => {
        const user = userEvent.setup();
        const onRequestIntegration = vi.fn();
        const slot = {
            id: 'bgm_game',
            name: 'Game BGM',
            type: 'audio',
            purpose: 'Game background music',
            status: 'uploaded' as const,
            uploaded_files: ['client/public/audio/bgm/game.mp3'],
        };

        render(
            <AssetsPanel
                manifest={{
                    version: 1,
                    project_target: { kind: 'web', engine: 'react', integration_mode: 'filesystem' },
                    slots: [slot],
                }}
                isLoading={false}
                onUpload={vi.fn()}
                onRequestIntegration={onRequestIntegration}
            />
        );

        expect(screen.getByText('Pending integration')).toBeInTheDocument();
        expect(screen.getByText('Uploaded, but not confirmed in runtime yet.')).toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: 'Ask BeeGame to integrate' }));
        expect(onRequestIntegration).toHaveBeenCalledWith(slot);
    });

    it('requests integration for all pending uploaded assets from the panel header', async () => {
        const user = userEvent.setup();
        const onRequestAllIntegration = vi.fn();
        const slots = [
            {
                id: 'bgm_game',
                name: 'Game BGM',
                type: 'audio',
                purpose: 'Game background music',
                status: 'uploaded' as const,
                uploaded_files: ['client/public/audio/bgm/game.mp3'],
            },
            {
                id: 'logo',
                name: 'Logo',
                type: 'image_2d',
                purpose: 'Title logo',
                status: 'uploaded' as const,
                uploaded_files: ['client/public/assets/logo.png'],
            },
        ];

        render(
            <AssetsPanel
                manifest={{
                    version: 1,
                    project_target: { kind: 'web', engine: 'react', integration_mode: 'filesystem' },
                    slots,
                }}
                isLoading={false}
                onUpload={vi.fn()}
                onRequestAllIntegration={onRequestAllIntegration}
            />
        );

        await user.click(screen.getByRole('button', { name: 'Integrate all pending' }));
        expect(onRequestAllIntegration).toHaveBeenCalledWith(slots);
    });
});
