import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import IndustryResearch from './IndustryResearch';
import { panoramaHref } from './navigation';

function OpenPanorama({ search }: { search: string }) {
  const href = panoramaHref(search);
  // A real document navigation keeps the original panorama's styles and history
  // isolated from React, and replaces only this compatibility route.
  useEffect(() => { window.location.replace(href); }, [href]);
  return <p><a href={href}>进入产业全景 →</a></p>;
}

export default function PanoramaEntry() {
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const id = params.get('industry') || params.get('industry_id');
  return id && !id.startsWith('open-') && !params.get('research') && !params.has('maintain') ? <OpenPanorama search={location.search} /> : <IndustryResearch />;
}
