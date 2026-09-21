import { expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { ChatAttachmentView } from './ChatAttachmentView';
import { authenticatedFetch } from '../../../services/apiClient';

vi.mock('../../../services/apiClient', () => ({ authenticatedFetch: vi.fn(), buildApiUrl: (path: string) => path }));

it('loads persisted images with authentication and releases the blob when unmounted', async () => {
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:restored-image');
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    vi.mocked(authenticatedFetch).mockResolvedValue(new Response(new Blob(['image'], { type: 'image/png' })));
    const view = render(<ChatAttachmentView attachment={{ type: 'image', filename: 'scene.png', mediaType: 'image/png',
        storageId: '00000000-0000-0000-0000-000000000000-image.png', projectId: 'p' }} />);
    try {
        await waitFor(() => expect(screen.getByRole('img', { name: 'scene.png' })).toHaveAttribute('src', 'blob:restored-image'));
        expect(authenticatedFetch).toHaveBeenCalledWith('/api/projects/p/chat-attachments/00000000-0000-0000-0000-000000000000-image.png', expect.objectContaining({ signal: expect.objectContaining({ aborted: false }) }));
        view.unmount();
        expect(revoke).toHaveBeenCalledWith('blob:restored-image');
    } finally { create.mockRestore(); revoke.mockRestore(); }
});
