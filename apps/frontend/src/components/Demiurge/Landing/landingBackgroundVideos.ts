import defaultBackgroundVideo from '../../../assets/background.mp4';
import marchBackgroundVideo from '../../../assets/hf_20260307_083826_e938b29f-a43a-41ec-a153-3d4730578ab8_c.mp4';
import aprilBackgroundVideo from '../../../assets/hf_20260405_074625_a81f018a-956b-43fb-9aee-4d1508e30e6a_c.mp4';
import aprilAltBackgroundVideo from '../../../assets/hf_20260406_094145_4a271a6c-3869-4f1c-8aa7-aeb0cb227994_c.mp4';
import juneBackgroundVideo from '../../../assets/hf_20260602_150901_c45b90ec-18d7-42ff-90e2-b95d7109e330_c.mp4';

export const fallbackLandingBackgroundVideo = defaultBackgroundVideo;

export const landingBackgroundVideos = [
    defaultBackgroundVideo,
    marchBackgroundVideo,
    aprilBackgroundVideo,
    aprilAltBackgroundVideo,
    juneBackgroundVideo,
];

export function selectDailyLandingBackgroundVideo(
    videos: readonly string[],
    date = new Date(),
): string {
    if (videos.length === 0) return '';
    const dayIndex = getLocalDayOfYear(date);
    return videos[dayIndex % videos.length] || videos[0] || '';
}

function getLocalDayOfYear(date: Date): number {
    const startOfYear = new Date(date.getFullYear(), 0, 1);
    const startOfDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    return Math.floor((startOfDay.getTime() - startOfYear.getTime()) / 86_400_000);
}
