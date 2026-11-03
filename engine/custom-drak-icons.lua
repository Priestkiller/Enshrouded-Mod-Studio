-- Included by the existing language/Tiger writer: a single EMM patch operation.
local function customDrakIcons(icons, mode)
    for _, icon in ipairs(icons or {}) do
        assert(loader.features.export, 'Drak icon proof requires export capability')
        local function hashEqual(a,b)
            return a.size==b.size and a.hash0==b.hash0 and a.hash1==b.hash1 and a.hash2==b.hash2
        end
        local found=nil
        for _, resource in ipairs(game.assets.get_resources_by_type('keen::UiTextureResource')) do
            if tostring(resource.guid)==icon.itemGuid then
                assert(found==nil,'Duplicate own Drak icon resource')
                found=resource
            end
        end
        assert(found,'Own Drak icon resource is missing')
        local d=found.data
        assert(hashEqual(d.data.hash,icon.hash),'Drak icon content reference differs')
        assert(d.size.x==icon.width and d.size.y==icon.height and tostring(d.format)==icon.format
            and d.levelCount==icon.levelCount and tostring(d.type)=='Texture2D' and not d.isTiled
            and d.debugName==icon.debugName,'Drak icon texture metadata differs')
        if mode=='patch' then
            assert(loader.features.patch,'Drak icon import requires patch capability')
            local bytes=io.read('src/'..icon.rawFile)
            assert(bytes:tail()==icon.rawSize,'Drak icon raw size differs')
            local created=game.assets.create_content(bytes)
            assert(hashEqual(created,icon.hash),'Drak icon imported content hash differs')
        elseif mode=='read' and icon.required then
            local bytes=game.assets.get_content(icon.hash):read_data()
            assert(bytes:tail()==icon.rawSize,'Drak icon archive content size differs')
            local checked=game.assets.create_content(bytes)
            assert(hashEqual(checked,icon.hash),'Drak icon archive bytes differ')
            io.export(icon.exportName..'.rgba',bytes)
        end
        io.export(icon.exportName..'.json',string.format('{"guid":"%s","width":%d,"height":%d,"format":"%s","levelCount":%d,"debugName":"%s","hash":{"size":%d,"hash0":%d,"hash1":%d,"hash2":%d}}',icon.itemGuid,d.size.x,d.size.y,tostring(d.format),d.levelCount,d.debugName,d.data.hash.size,d.data.hash.hash0,d.data.hash.hash1,d.data.hash.hash2))
    end
end
