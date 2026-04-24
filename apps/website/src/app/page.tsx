import React from "react";

import { ControlWidget } from "@/components/widgets/control/control-widget";
import { LoadWidget } from "@/components/widgets/load/load-widget";
import { PressureWidget } from "@/components/widgets/pressure/pressure-widget";
import { VideoWidget } from "@/components/widgets/video/video-widget";

export default function Page() {
  return (
    <div className="grid min-h-0 flex-1 auto-rows-fr grid-cols-2 gap-2 overflow-hidden p-4 pt-2">
      <ControlWidget />
      <VideoWidget />
      <PressureWidget />
      <LoadWidget />
    </div>
  );
}
