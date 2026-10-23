// Visual-only fixtures; no project/API/model calls.
import { createRoot } from 'react-dom/client'
import { ChatImage } from '../../src/components/Demiurge/Sidebar/ChatImage'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../../src/components/beui/motion/tabs'
import '../../src/index.css'
const preview = (color:string) => 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="240"><rect width="400" height="240" fill="${color}"/><circle cx="200" cy="100" r="50" fill="#fff"/><path d="M0 190H400V240H0Z" fill="#172b36"/></svg>`)
createRoot(document.getElementById('root')!).render(<main style={{width:'min(440px,100%)',margin:'32px auto',padding:16}}>
  <Tabs defaultValue="chat"><TabsList><TabsTrigger value="chat">Chat</TabsTrigger><TabsTrigger value="todo">Todo</TabsTrigger></TabsList>
    <TabsContent value="chat" keepMounted className="data-[hidden]:hidden">
      <p>图片输出</p><div className="chat-image-gallery">
        {['#bc7b29','#567b62','#586ea6'].map((color,i)=><ChatImage key={color} src={preview(color)} alt={['AI 素材','程序绘制','网页素材'][i]} lang="zh"/>)}
      </div>
      <p>加载与失败状态</p><div className="chat-image-gallery"><ChatImage alt="加载中" pending lang="zh"/><ChatImage alt="失败素材" error lang="zh"/></div>
    </TabsContent>
    <TabsContent value="todo">Todo</TabsContent>
  </Tabs>
</main>)
