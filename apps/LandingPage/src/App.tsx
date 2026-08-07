import { Header } from "./components/Header";
import { NarrativeSections } from "./components/NarrativeSections";

export default function App() {
  return (
    <div
      className="site-page"
      onPointerEnter={(event) => event.currentTarget.style.setProperty("--pointer-opacity", "1")}
      onPointerLeave={(event) => event.currentTarget.style.setProperty("--pointer-opacity", "0")}
      onPointerMove={(event) => {
        const parallaxX = (event.clientX / window.innerWidth) * 2 - 1;
        const parallaxY = (event.clientY / window.innerHeight) * 2 - 1;
        event.currentTarget.style.setProperty("--pointer-x", `${event.clientX}px`);
        event.currentTarget.style.setProperty("--pointer-y", `${event.clientY}px`);
        event.currentTarget.style.setProperty("--parallax-x", parallaxX.toFixed(3));
        event.currentTarget.style.setProperty("--parallax-y", parallaxY.toFixed(3));
        event.currentTarget.style.setProperty("--pointer-opacity", "1");
      }}
    >
      <span className="pointer-orb" aria-hidden="true" />
      <Header />
      <NarrativeSections />
    </div>
  );
}
