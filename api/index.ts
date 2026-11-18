import {app} from '../server/app';export const config={runtime:'nodejs',maxDuration:300};export default{fetch:(request:Request)=>app.fetch(request,process.env)};
